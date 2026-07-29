/**
 * Tidal OAuth 2.0 + PKCE 流程
 *
 * 流程：
 * 1. startOauthFlow()：生成 code_verifier + state，构造 authorizeUrl，启动本地 callback server
 * 2. 渲染端打开浏览器跳转 authorizeUrl，用户授权后 Tidal 重定向到 localhost:1419/callback?code=xxx&state=yyy
 * 3. waitForCallback()：callback server 收到 code，校验 state，POST /oauth2/token 交换 access_token + refresh_token
 * 4. refreshAccessToken()：access_token 过期时用 refresh_token 走同一端点刷新
 *
 * code_verifier 仅保存在主进程内存中（不落盘），completeOauth 时与 callback 携带的 state 一起验证。
 */

import http from "node:http";
import {
  TIDAL_CLIENT_ID,
  TIDAL_LOGIN_BASE,
  TIDAL_REDIRECT_PORT,
  TIDAL_REDIRECT_URI,
  TIDAL_SCOPES,
} from "./config";
import { computeCodeChallenge, generateCodeVerifier, generateState } from "./pkce";
import { tidalPostForm } from "./request";
import { tidalLog } from "@main/utils/logger";
import type { TidalSubscription } from "@shared/types/tidal";

/** token 交换端点响应 */
export interface TidalTokenResponse {
  access_token: string;
  refresh_token: string;
  /** 过期秒数（通常 3600 = 1 小时） */
  expires_in: number;
  token_type: string;
  /** 用户 ID（部分版本返回） */
  user_id?: string;
  /** 订阅信息（部分版本返回，多数情况下需另调 /users/me） */
  subscription?: string;
}

/** /users/me 响应（用于拿 nickname + subscription） */
export interface TidalUsersMeResp {
  id?: number | string;
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  subscription?: {
    type?: string;
    status?: string;
  };
}

/** OAuth 流程会话状态（保存在主进程内存中，不落盘） */
interface OauthSession {
  codeVerifier: string;
  state: string;
  server: http.Server | null;
  /** Promise resolve / reject，waitForCallback 调用时填充，callback 收到 code 后调用 */
  resolve: ((code: string) => void) | null;
  reject: ((err: Error) => void) | null;
  /** 60 秒超时定时器 */
  timeoutTimer: NodeJS.Timeout | null;
  /**
   * callback server 启动期错误缓存
   *
   * startCallbackServer 是异步的，可能在 waitForCallback 调用前就失败（端口被占用等）。
   * 此时 session.reject 还是 null，错误无处投递。waitForCallback 调用时检查此字段，
   * 非 null 则立即 reject，避免阻塞 60s 超时。
   */
  earlyError: Error | null;
}

let currentSession: OauthSession | null = null;

/** 构造授权 URL */
const buildAuthorizeUrl = (codeChallenge: string, state: string): string => {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: TIDAL_CLIENT_ID,
    redirect_uri: TIDAL_REDIRECT_URI,
    scope: TIDAL_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `${TIDAL_LOGIN_BASE}/oauth2/authorize?${params.toString()}`;
};

/**
 * 处理 callback 收到的 code：校验 state 后 resolve promise
 *
 * 由 callback server 的 request handler 调用。
 */
const handleCallback = (session: OauthSession, code: string, state: string): void => {
  if (state !== session.state) {
    session.reject?.(new Error("Tidal OAuth state mismatch (CSRF protection)"));
    return;
  }
  session.resolve?.(code);
};

/**
 * 清理 session 内部资源（关闭 server + 清定时器），不重置 currentSession
 */
const disposeSessionResources = (session: OauthSession): void => {
  if (session.timeoutTimer) {
    clearTimeout(session.timeoutTimer);
    session.timeoutTimer = null;
  }
  if (session.server) {
    try {
      session.server.close();
    } catch {
      // ignore
    }
    session.server = null;
  }
};

/**
 * 启动本地 callback HTTP server（监听 1419 端口）
 *
 * 仅在用户点击登录时调用，启动期不监听。
 * 收到 GET /callback?code=xxx&state=yyy 后校验 state，取 code 关闭 server。
 */
const startCallbackServer = (session: OauthSession): Promise<void> => {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = req.url ?? "";
      if (!url.startsWith("/callback")) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      const parsed = new URL(url, TIDAL_REDIRECT_URI);
      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state");
      const error = parsed.searchParams.get("error");

      // 给浏览器返回友好提示，避免用户看到空白页
      const sendResponse = (ok: boolean, message: string): void => {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          `<!doctype html><html><head><meta charset="utf-8"><title>Tidal Login</title>` +
            `<style>body{font-family:system-ui,sans-serif;text-align:center;padding:60px;}` +
            `h1{color:${ok ? "#0a0" : "#a00"};}</style></head><body>` +
            `<h1>${ok ? "✓" : "✗"} ${message}</h1>` +
            `<p>可关闭此页面并返回 Soto Player。</p></body></html>`,
        );
      };

      if (error) {
        sendResponse(false, `授权失败: ${error}`);
        session.reject?.(new Error(`Tidal OAuth error: ${error}`));
        return;
      }

      if (!code || !state) {
        sendResponse(false, "回调缺少 code 或 state");
        session.reject?.(new Error("Tidal OAuth callback missing code/state"));
        return;
      }

      sendResponse(true, "授权成功");
      handleCallback(session, code, state);
    });

    server.on("error", (err) => {
      // server 启动失败（如端口被占用）或运行时错误
      // 缓存到 earlyError：若 waitForCallback 尚未调用（session.reject 为 null），下次调用时立即 reject
      // 若 waitForCallback 已调用（session.reject 已填充），直接 reject promise
      session.earlyError = err;
      session.reject?.(err);
      reject(err);
    });

    server.listen(TIDAL_REDIRECT_PORT, "127.0.0.1", () => {
      tidalLog.info(
        `[ERR-12021-A] Tidal callback server 已启动，监听 127.0.0.1:${TIDAL_REDIRECT_PORT}`,
      );
      resolve();
    });

    session.server = server;

    // 60 秒超时：用户未在浏览器完成授权
    session.timeoutTimer = setTimeout(() => {
      session.reject?.(new Error("Tidal OAuth callback timeout (60s)"));
    }, 60_000);
    session.timeoutTimer.unref?.();
  });
};

/**
 * 启动 OAuth 流程：生成 verifier + state，构造 authorizeUrl，启动 callback server
 *
 * @returns authorizeUrl 给渲染端打开浏览器
 */
export const startOauthFlow = (): { authorizeUrl: string } => {
  // 若上次 session 未关闭，先清理
  cleanupSession();

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = computeCodeChallenge(codeVerifier);
  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl(codeChallenge, state);

  currentSession = {
    codeVerifier,
    state,
    server: null,
    resolve: null,
    reject: null,
    timeoutTimer: null,
    earlyError: null,
  };

  // 异步启动 callback server（不阻塞 authorizeUrl 返回）
  startCallbackServer(currentSession).catch((err) => {
    tidalLog.error("[ERR-12022-A] Tidal callback server 启动失败:", err);
    cleanupSession();
  });

  tidalLog.info(
    `[ERR-12021-A] Tidal OAuth 流程已启动: state=${state.slice(0, 8)}... verifier_len=${codeVerifier.length}`,
  );
  return { authorizeUrl };
};

/**
 * 等待 callback server 收到 code，交换 token
 *
 * 阻塞直至：callback 收到 code（成功）/ 60s 超时 / state 不匹配 / server 启动失败。
 *
 * 检查 earlyError：若 server 在本函数调用前已失败（端口被占用等），立即抛出错误，
 * 避免阻塞到 60s 超时。
 */
export const waitForCallback = async (): Promise<TidalTokenResponse> => {
  if (!currentSession) {
    throw new Error("Tidal OAuth session not started; call startOauthFlow first");
  }

  const session = currentSession;

  // 启动期已发生错误（端口占用等）：立即失败
  if (session.earlyError) {
    const err = session.earlyError;
    cleanupSession();
    throw err;
  }

  try {
    // 用 Promise 等待 callback server 收到合法 code
    const code = await new Promise<string>((resolve, reject) => {
      session.resolve = (c) => resolve(c);
      session.reject = (err) => reject(err);
    });

    // 交换 token
    return await exchangeCodeForToken(code, session.codeVerifier);
  } finally {
    // 无论成功失败，都清理 session 资源（关闭 server）
    cleanupSession();
  }
};

/**
 * 用 code + code_verifier 交换 access_token + refresh_token
 *
 * POST https://login.tidal.com/oauth2/token
 * form-urlencoded: grant_type=authorization_code&code=...&redirect_uri=...&client_id=...&code_verifier=...
 */
export const exchangeCodeForToken = async (
  code: string,
  codeVerifier: string,
): Promise<TidalTokenResponse> => {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: TIDAL_REDIRECT_URI,
    client_id: TIDAL_CLIENT_ID,
    code_verifier: codeVerifier,
  }).toString();

  try {
    const resp = await tidalPostForm<TidalTokenResponse>(
      `${TIDAL_LOGIN_BASE}/oauth2/token`,
      body,
    );
    tidalLog.info(
      `[ERR-12023-A] Tidal token 交换成功: expires_in=${resp.expires_in}s user_id=${resp.user_id ?? "?"}`,
    );
    return resp;
  } catch (err) {
    tidalLog.error("[ERR-12023-A] Tidal token 交换失败:", err);
    throw err;
  }
};

/**
 * 用 refresh_token 刷新 access_token
 *
 * @param refreshToken 上次的 refresh_token
 * @returns 新的 token 响应（含新的 access_token + 可能新的 refresh_token）
 */
export const refreshAccessToken = async (
  refreshToken: string,
): Promise<TidalTokenResponse> => {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: TIDAL_CLIENT_ID,
  }).toString();

  try {
    const resp = await tidalPostForm<TidalTokenResponse>(
      `${TIDAL_LOGIN_BASE}/oauth2/token`,
      body,
    );
    tidalLog.info(
      `[ERR-12024-A] Tidal token 刷新成功: expires_in=${resp.expires_in}s`,
    );
    return resp;
  } catch (err) {
    tidalLog.error("[ERR-12025-A] Tidal token 刷新失败:", err);
    throw err;
  }
};

/**
 * 把 Tidal 订阅响应规范化为内部 TidalSubscription 字面量
 *
 * Tidal subscription.type 通常为 "HIFI" / "HIFI_PLUS" / "FREE"。
 */
export const normalizeSubscription = (raw: TidalUsersMeResp): TidalSubscription => {
  const type = (raw.subscription?.type ?? "").toUpperCase();
  const status = (raw.subscription?.status ?? "").toUpperCase();
  if (type.includes("HIFI_PLUS") || type.includes("HIRES_PLUS")) return "hifi_plus";
  if (type.includes("HIFI") || type.includes("HIRES")) return "hifi";
  if (type.includes("FREE") || status.includes("EXPIRED")) return "free";
  return "unknown";
};

/** 清理当前 session（关闭 server + 清定时器 + 重置 currentSession） */
export const cleanupSession = (): void => {
  if (!currentSession) return;
  disposeSessionResources(currentSession);
  currentSession = null;
};

/** 取消当前 OAuth 流程（用户关闭登录窗口时调用） */
export const cancelOauthFlow = (): void => {
  if (currentSession) {
    // 主动 reject 正在等待的 waitForCallback Promise，避免阻塞 60s 超时
    currentSession.reject?.(new Error("Tidal OAuth cancelled by user"));
  }
  cleanupSession();
  tidalLog.info("[ERR-12022-A] Tidal OAuth 流程已取消");
};
