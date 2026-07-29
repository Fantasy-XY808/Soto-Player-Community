/**
 * Spotify 认证模块
 *
 * 支持三种模式（按优先级自动回落）：
 * 1. Client Credentials Flow（应用级，client_id + client_secret → access_token）
 *    用于 /v1/search 等公开接口；不能访问用户私有数据
 * 2. Authorization Code + PKCE（用户级，S256 code_challenge）
 *    用户在浏览器窗口登录后，授权码换 access_token + refresh_token
 * 3. 浏览器 cookie 兑换（sp_dc cookie → open.spotify.com/get_access_token）
 *    绕过 OAuth，直接用浏览器登录态换 token；可访问用户私有数据
 *
 * token 自动 refresh：
 * - PKCE access_token 过期前 60 秒自动用 refresh_token 换新
 * - 浏览器 cookie 兑换的 token 过期前自动重新兑换
 * - userTokenGeneration 计数器：用户登出 / 重新登录时作废所有进行中的异步请求
 *
 * 注意：client_id / client_secret 由用户在设置中写入或留空，不硬编码。
 */

import { randomBytes, createHash } from "node:crypto";
import { spotifyLog } from "@main/utils/logger";
import {
  SPOTIFY_AUTH_URL,
  SPOTIFY_TOKEN_URL,
  SPOTIFY_COOKIE_EXCHANGE_URL,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_SCOPES,
  SPOTIFY_UA,
  TOKEN_EXPIRE_BUFFER_MS,
} from "./core/config";
import {
  getClientId,
  getClientSecret,
  getUserToken,
  setUserToken,
  clearUserToken,
  getBrowserCookie,
  setBrowserCookie,
  clearBrowserCookie,
} from "./core/credentials";

/** Client Credentials token 缓存（应用级，内存） */
interface AppTokenCache {
  accessToken: string;
  expireAt: number;
}

/** PKCE 用户 token 缓存（内存，与落盘保持同步） */
interface UserTokenCache {
  accessToken: string;
  refreshToken: string;
  expireAt: number;
}

/** 浏览器 cookie 兑换的 token 缓存（内存） */
interface BrowserTokenCache {
  accessToken: string;
  expireAt: number;
}

let appTokenCache: AppTokenCache | null = null;
let appFetchingPromise: Promise<string | null> | null = null;

let userTokenCache: UserTokenCache | null = null;
let userFetchingPromise: Promise<string | null> | null = null;
/** 用户 token 代次：每次登出 / 重新登录 +1，作废所有进行中的异步请求 */
let userTokenGeneration = 0;

let browserTokenCache: BrowserTokenCache | null = null;

/** 生成 PKCE code_verifier（43+ 字符的 base64url 随机串） */
const generateCodeVerifier = (): string => randomBytes(32).toString("base64url");

/** 生成 PKCE code_challenge（S256：base64url(sha256(verifier))） */
const generateCodeChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

/**
 * 获取应用级 access token（Client Credentials Flow）
 *
 * 用于 /v1/search 等公开接口；不能访问用户私有数据。
 * @returns access token 或 null（未配置 client_id / client_secret）
 */
export const getAppAccessToken = async (): Promise<string | null> => {
  if (appTokenCache && appTokenCache.expireAt > Date.now()) {
    return appTokenCache.accessToken;
  }
  if (appFetchingPromise) return appFetchingPromise;

  appFetchingPromise = (async (): Promise<string | null> => {
    try {
      const clientId = getClientId();
      const clientSecret = getClientSecret();
      if (!clientId || !clientSecret) {
        spotifyLog.warn("[spotify] clientId / clientSecret 未配置，跳过应用级认证");
        return null;
      }

      const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
      const res = await fetch(SPOTIFY_TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const text = await res.text();
        spotifyLog.warn(`[spotify] 应用级 token 请求失败: ${res.status} ${text}`);
        return null;
      }

      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) {
        spotifyLog.warn("[spotify] 应用级 token 响应缺少 access_token");
        return null;
      }

      const expireAt =
        Date.now() + (data.expires_in ?? 3600) * 1000 - TOKEN_EXPIRE_BUFFER_MS;
      appTokenCache = { accessToken: data.access_token, expireAt };
      return data.access_token;
    } catch (err) {
      spotifyLog.warn("[spotify] 获取应用级 token 失败:", err);
      return null;
    } finally {
      appFetchingPromise = null;
    }
  })();

  return appFetchingPromise;
};

/** 清空应用级 token 缓存（配置变更后调用） */
export const clearAppTokenCache = (): void => {
  appTokenCache = null;
  appFetchingPromise = null;
};

/**
 * 用 refresh_token 换取新 access_token（PKCE 流程）
 */
const doRefreshUserToken = async (
  refreshToken: string,
): Promise<UserTokenCache | null> => {
  const clientId = getClientId();
  if (!clientId) {
    spotifyLog.warn("[spotify] clientId 未配置，无法刷新用户 token");
    return null;
  }

  try {
    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      spotifyLog.warn(`[spotify] 刷新用户 token 失败: ${res.status} ${text}`);
      return null;
    }

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      spotifyLog.warn("[spotify] 刷新用户 token 响应缺少 access_token");
      return null;
    }

    const expireAt =
      Date.now() + (data.expires_in ?? 3600) * 1000 - TOKEN_EXPIRE_BUFFER_MS;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expireAt,
    };
  } catch (err) {
    spotifyLog.warn("[spotify] 刷新用户 token 失败:", err);
    return null;
  }
};

/**
 * 使用 sp_dc cookie 兑换 access_token（浏览器登录模式）
 *
 * 端点：GET https://open.spotify.com/get_access_token
 * 返回 JSON：{ accessToken, accessTokenExpirationTimestampMs, ... }
 */
export const exchangeBrowserCookieForToken = async (
  cookie: string,
): Promise<BrowserTokenCache | null> => {
  try {
    const res = await fetch(SPOTIFY_COOKIE_EXCHANGE_URL, {
      headers: {
        Cookie: cookie,
        "User-Agent": SPOTIFY_UA,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      spotifyLog.warn(`[spotify] cookie 兑换 token 失败: ${res.status}`);
      return null;
    }

    const data = (await res.json()) as {
      accessToken?: string;
      accessTokenExpirationTimestampMs?: number;
    };
    if (!data.accessToken) {
      spotifyLog.warn("[spotify] cookie 兑换响应缺少 accessToken");
      return null;
    }

    const expireAt = data.accessTokenExpirationTimestampMs ?? Date.now() + 3600_000;
    return { accessToken: data.accessToken, expireAt };
  } catch (err) {
    spotifyLog.warn("[spotify] cookie 兑换 token 异常:", err);
    return null;
  }
};

/**
 * 获取用户级 access token（自动 refresh，作废过期请求）
 *
 * 优先级：内存缓存 → 落盘 PKCE token（含自动 refresh）→ 浏览器 cookie 兑换
 * @returns access token 或 null（未登录任何模式）
 */
export const getUserAccessToken = async (): Promise<string | null> => {
  if (userFetchingPromise) return userFetchingPromise;

  const generation = userTokenGeneration;
  userFetchingPromise = (async (): Promise<string | null> => {
    // 代次不匹配说明用户已登出 / 重新登录，当前请求作废
    if (generation !== userTokenGeneration) return null;

    // 1. 内存缓存命中
    if (userTokenCache && userTokenCache.expireAt > Date.now()) {
      return userTokenCache.accessToken;
    }

    // 2. 落盘 PKCE token
    const stored = getUserToken();
    if (stored && stored.expireAt > Date.now()) {
      if (generation !== userTokenGeneration) return null;
      userTokenCache = stored;
      return stored.accessToken;
    }

    // 3. PKCE token 过期但有 refresh_token，自动刷新
    if (stored?.refreshToken) {
      const refreshed = await doRefreshUserToken(stored.refreshToken);
      if (refreshed) {
        if (generation !== userTokenGeneration) return null;
        userTokenCache = refreshed;
        setUserToken(refreshed);
        return refreshed.accessToken;
      }
    }

    // 4. 浏览器 cookie 兑换（兜底）
    if (browserTokenCache && browserTokenCache.expireAt > Date.now()) {
      return browserTokenCache.accessToken;
    }

    const browserCookie = getBrowserCookie();
    if (browserCookie) {
      const exchanged = await exchangeBrowserCookieForToken(browserCookie);
      if (exchanged) {
        if (generation !== userTokenGeneration) return null;
        browserTokenCache = exchanged;
        return exchanged.accessToken;
      }
    }

    return null;
  })().finally(() => {
    if (generation === userTokenGeneration) userFetchingPromise = null;
  });

  return userFetchingPromise;
};

/**
 * 启动 Spotify OAuth + PKCE 登录流程
 *
 * 1. 生成 code_verifier / code_challenge
 * 2. 拼接授权 URL，交给 spotifyLogin 窗口加载
 * 3. 窗口拦截回调 URL，提取 code
 * 4. 用 code + verifier 换 access_token + refresh_token
 *
 * @returns 登录成功返回 token 缓存；失败 / 取消返回 null
 */
export const startSpotifyLogin = async (): Promise<UserTokenCache | null> => {
  const generation = userTokenGeneration;
  const clientId = getClientId();
  if (!clientId) {
    spotifyLog.warn("[spotify] clientId 未配置，无法启动 OAuth 登录");
    return null;
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  const authUrl =
    `${SPOTIFY_AUTH_URL}?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(SPOTIFY_REDIRECT_URI)}` +
    `&code_challenge_method=S256` +
    `&code_challenge=${encodeURIComponent(codeChallenge)}` +
    `&scope=${encodeURIComponent(SPOTIFY_SCOPES)}`;

  // 动态导入避免循环依赖：spotifyBrowserLogin 也引用了 credentials
  const { openSpotifyBrowserLoginWindow } = await import("@main/window/spotifyBrowserLogin");
  const code = await openSpotifyBrowserLoginWindow(authUrl);
  if (!code) {
    spotifyLog.warn("[spotify] OAuth 登录窗口未返回 code");
    return null;
  }
  if (generation !== userTokenGeneration) return null;

  try {
    const res = await fetch(SPOTIFY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        client_id: clientId,
        code_verifier: codeVerifier,
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      spotifyLog.warn(`[spotify] OAuth 换取 token 失败: ${res.status} ${text}`);
      return null;
    }

    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token || !data.refresh_token) {
      spotifyLog.warn("[spotify] OAuth 换取 token 响应缺少字段");
      return null;
    }

    if (generation !== userTokenGeneration) return null;
    const expireAt =
      Date.now() + (data.expires_in ?? 3600) * 1000 - TOKEN_EXPIRE_BUFFER_MS;
    const cache: UserTokenCache = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expireAt,
    };
    userTokenCache = cache;
    setUserToken(cache);
    userFetchingPromise = null;
    return cache;
  } catch (err) {
    spotifyLog.warn("[spotify] OAuth 换取 token 异常:", err);
    return null;
  }
};

/** Spotify 用户资料原始响应 */
export interface SpotifyUserProfileRaw {
  id: string;
  display_name: string | null;
  email?: string;
  images?: Array<{ url: string }>;
}

/**
 * 获取 Spotify 用户资料（验证 token 有效性）
 * @param token - access token
 */
export const getSpotifyUserProfile = async (
  token: string,
): Promise<SpotifyUserProfileRaw | null> => {
  try {
    const res = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      spotifyLog.warn(`[spotify] 获取用户资料失败: ${res.status}`);
      return null;
    }
    return (await res.json()) as SpotifyUserProfileRaw;
  } catch (err) {
    spotifyLog.warn("[spotify] 获取用户资料异常:", err);
    return null;
  }
};

/**
 * 登出 Spotify（清除用户 token + 浏览器 cookie，作废进行中的请求）
 */
export const logoutSpotify = (): void => {
  clearUserTokenCache();
  clearUserToken();
  clearBrowserCookie();
};

/**
 * 清空用户 token 缓存（配置变更 / 登出时调用）
 *
 * generation +1 让所有进行中的 getUserAccessToken / startSpotifyLogin 作废
 */
export const clearUserTokenCache = (): void => {
  userTokenGeneration += 1;
  userTokenCache = null;
  userFetchingPromise = null;
  browserTokenCache = null;
};

/** 写入浏览器 cookie 到落盘存储（spotifyBrowserLogin 窗口登录成功后调用） */
export const setSpotifyBrowserCookie = (cookie: string): void => {
  setBrowserCookie(cookie);
  // 新 cookie 写入后，作废旧 token 缓存，下次重新兑换
  browserTokenCache = null;
};

/** 读取浏览器 cookie（供 song 模块在 cookie 模式下使用） */
export const getSpotifyBrowserCookie = (): string | null => getBrowserCookie();

/** 清空浏览器 cookie */
export const clearSpotifyBrowserCookie = (): void => {
  clearBrowserCookie();
  browserTokenCache = null;
};
