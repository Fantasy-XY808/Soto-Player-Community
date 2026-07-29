/**
 * Spotify 账户 IPC
 *
 * 与 Tidal / Qobuz 之不同：
 * - 三种认证模式由用户在设置中选择，凭证文件 {configDir}/spotify.json 统一加密落盘
 *   1. Client Credentials（应用级，clientId + clientSecret → access_token）
 *   2. Authorization Code + PKCE（用户级，浏览器登录 → access_token + refresh_token）
 *   3. 浏览器 cookie 兑换（sp_dc cookie → access_token，绕过 OAuth）
 *
 * 注册通道：
 * - spotify:setClientCredentials(clientId, clientSecret)
 *     写入应用级凭证；空字符串视为清除
 * - spotify:getClientCredentials
 *     返回 { configured: boolean }；不暴露明文 secret 给渲染端
 * - spotify:clearClientCredentials
 *     清除应用级凭证 + 用户 token + 浏览器 cookie（全量登出）
 * - spotify:startLogin
 *     启动 PKCE OAuth 流程：弹出登录窗口 → 授权码换 token → 落盘
 * - spotify:startBrowserLogin
 *     启动浏览器 cookie 模式：弹出登录窗口 → 收集 sp_dc → 写入凭证
 * - spotify:setBrowserCookie(cookie)
 *     手动写入 sp_dc cookie 字符串
 * - spotify:getStatus
 *     返回登录态 + 用户资料（display_name / email / avatar）
 * - spotify:logout
 *     清除用户级 token + 浏览器 cookie（保留 client credentials）
 */

import { ipcMain } from "electron";
import { spotifyLog } from "@main/utils/logger";
import {
  setClientCredentials,
  getClientId,
  getClientSecret,
  getUserToken,
  getBrowserCookie,
  clearAllSpotifyCredentials,
} from "@main/apis/spotify/core/credentials";
import {
  startSpotifyLogin,
  getSpotifyUserProfile,
  getUserAccessToken,
  logoutSpotify,
  clearUserTokenCache,
  clearAppTokenCache,
  setSpotifyBrowserCookie,
  clearSpotifyBrowserCookie,
} from "@main/apis/spotify/auth";

/** Spotify 用户资料（经 IPC 返回给渲染端，字段精简） */
export interface SpotifyProfile {
  id: string;
  display_name: string | null;
  email?: string;
  avatar?: string;
}

/** Spotify 登录状态 */
export interface SpotifyStatusResult {
  /** 是否已配置 client_id / client_secret（应用级凭证） */
  clientConfigured: boolean;
  /** 是否已登录用户级（PKCE token 或浏览器 cookie） */
  userLoggedIn: boolean;
  /** 当前生效的认证模式 */
  authMode: "none" | "client_credentials" | "pkce" | "browser_cookie";
  /** 用户资料；userLoggedIn=false 时为 null */
  profile: SpotifyProfile | null;
}

/** 派生当前认证模式 */
const deriveAuthMode = (): SpotifyStatusResult["authMode"] => {
  if (getUserToken()) return "pkce";
  if (getBrowserCookie()) return "browser_cookie";
  if (getClientId() && getClientSecret()) return "client_credentials";
  return "none";
};

/** 取用户资料；失败 / 未登录返回 null */
const fetchProfile = async (): Promise<SpotifyProfile | null> => {
  const token = await getUserAccessToken();
  if (!token) return null;
  const raw = await getSpotifyUserProfile(token);
  if (!raw) return null;
  return {
    id: raw.id,
    display_name: raw.display_name,
    email: raw.email,
    avatar: raw.images?.[0]?.url,
  };
};

export const registerSpotifyIpc = (): void => {
  // 写入 client_id / client_secret（空字符串视为清除对应字段）
  ipcMain.handle(
    "spotify:setClientCredentials",
    (_e, clientId: string, clientSecret: string): { ok: true } | { ok: false; error: string } => {
      try {
        setClientCredentials(clientId ?? "", clientSecret ?? "");
        // 凭证变更后作废旧 token 缓存，下次重新走应用级 / PKCE 流程
        clearAppTokenCache();
        clearUserTokenCache();
        spotifyLog.info(
          `[spotify] client credentials updated (clientId configured=${!!clientId})`,
        );
        return { ok: true };
      } catch (err) {
        spotifyLog.error("[spotify] setClientCredentials failed:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 查询是否已配置应用级凭证（不暴露明文 secret）
  ipcMain.handle(
    "spotify:getClientCredentials",
    (): { configured: boolean; clientId: string } => {
      const clientId = getClientId();
      const clientSecret = getClientSecret();
      return {
        configured: !!clientId && !!clientSecret,
        // clientId 非敏感，回显便于用户校验
        clientId,
      };
    },
  );

  // 全量清除所有 Spotify 凭证（应用级 + 用户级 + 浏览器 cookie）
  ipcMain.handle(
    "spotify:clearClientCredentials",
    (): { ok: true } | { ok: false; error: string } => {
      try {
        clearAllSpotifyCredentials();
        clearAppTokenCache();
        clearUserTokenCache();
        spotifyLog.info("[spotify] all credentials cleared");
        return { ok: true };
      } catch (err) {
        spotifyLog.error("[spotify] clearClientCredentials failed:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 启动 PKCE OAuth 登录流程
  // 成功返回 { ok: true, profile }；用户取消返回 { ok: false, error: "canceled" }
  ipcMain.handle(
    "spotify:startLogin",
    async (): Promise<
      | { ok: true; profile: SpotifyProfile | null }
      | { ok: false; error: string }
    > => {
      try {
        const token = await startSpotifyLogin();
        if (!token) return { ok: false, error: "canceled" };
        // 立即取用户资料便于 UI 显示
        const profile = await fetchProfile();
        spotifyLog.info(
          `[spotify] OAuth login success: user=${profile?.display_name ?? "<unknown>"}`,
        );
        return { ok: true, profile };
      } catch (err) {
        spotifyLog.warn("[spotify] startLogin failed:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 启动浏览器 cookie 模式登录（sp_dc cookie → access_token）
  // 实际窗口加载由 apis:openLoginWeb 统一管理；本通道仅作为冗余入口
  // 成功返回 { ok: true, profile }；失败 / 取消返回 { ok: false, error }
  ipcMain.handle(
    "spotify:startBrowserLogin",
    async (): Promise<
      | { ok: true; profile: SpotifyProfile | null }
      | { ok: false; error: string }
    > => {
      try {
        const { openSpotifyBrowserLoginWindow } = await import("@main/window/spotifyBrowserLogin");
        const cookie = await openSpotifyBrowserLoginWindow();
        if (!cookie) return { ok: false, error: "canceled" };
        setSpotifyBrowserCookie(cookie);
        const profile = await fetchProfile();
        spotifyLog.info(
          `[spotify] browser cookie login success: user=${profile?.display_name ?? "<unknown>"}`,
        );
        return { ok: true, profile };
      } catch (err) {
        spotifyLog.warn("[spotify] startBrowserLogin failed:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 手动写入 sp_dc cookie 字符串（用户从浏览器 DevTools 复制粘贴）
  ipcMain.handle(
    "spotify:setBrowserCookie",
    (_e, cookie: string): { ok: true } | { ok: false; error: string } => {
      try {
        const plain = (cookie ?? "").trim();
        if (!plain) return { ok: false, error: "empty cookie" };
        setSpotifyBrowserCookie(plain);
        return { ok: true };
      } catch (err) {
        spotifyLog.error("[spotify] setBrowserCookie failed:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  // 查询登录状态 + 用户资料
  ipcMain.handle("spotify:getStatus", async (): Promise<SpotifyStatusResult> => {
    const clientConfigured = !!getClientId() && !!getClientSecret();
    const authMode = deriveAuthMode();
    if (authMode === "none") {
      return { clientConfigured, userLoggedIn: false, authMode, profile: null };
    }
    // client_credentials 模式无用户资料
    if (authMode === "client_credentials") {
      return { clientConfigured, userLoggedIn: false, authMode, profile: null };
    }
    const profile = await fetchProfile();
    return {
      clientConfigured,
      userLoggedIn: !!profile,
      authMode,
      profile,
    };
  });

  // 登出：清除用户级 token + 浏览器 cookie（保留 client credentials）
  ipcMain.handle("spotify:logout", (): { ok: true } | { ok: false; error: string } => {
    try {
      logoutSpotify();
      spotifyLog.info("[spotify] user logged out (client credentials retained)");
      return { ok: true };
    } catch (err) {
      spotifyLog.error("[spotify] logout failed:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 清除浏览器 cookie（保留 PKCE token）
  ipcMain.handle("spotify:clearBrowserCookie", (): { ok: true } | { ok: false; error: string } => {
    try {
      clearSpotifyBrowserCookie();
      return { ok: true };
    } catch (err) {
      spotifyLog.error("[spotify] clearBrowserCookie failed:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
};
