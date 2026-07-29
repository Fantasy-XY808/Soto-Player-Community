/**
 * Tidal 请求层
 *
 * 设计：
 * - 所有端点需 Authorization: Bearer ${access_token}（从 safeStorage 加密读取）
 * - 海外 API 必须用 overseasFetch 走代理（与 Qobuz 一致）
 * - 401 视为 token 失效，自动刷新一次后重试（autoRefresh=true 时）
 * - 8 秒超时
 *
 * 与 ipc/tidal.ts 的关系：
 * - request.ts 调 getTidalTokenSync() 注入 Authorization header
 * - 401 时调 persistRefreshedToken / invalidateTidalToken 落盘新 token
 * - 单向依赖，无循环（ipc/tidal.ts 不反向依赖 request.ts）
 */

import { TIDAL_UA } from "./config";
import { getTidalTokenSync } from "@main/ipc/tidal";
import { overseasFetch } from "@main/services/proxyDispatcher";
import { tidalLog } from "@main/utils/logger";
import type { TidalTokenPayload } from "@shared/types/tidal";

interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 是否跳过自动注入 Authorization header（如 OAuth token 交换端点） */
  noAuth?: boolean;
  /**
   * 401 时是否自动刷新 token 并重试一次
   *
   * 默认 true：search / song_url 等数据端点受益
   * verifyToken 显式传 false：token 失效时应返回错误让 UI 提示用户重新登录
   */
  autoRefresh?: boolean;
}

/** token 失效错误（上层捕获后可触发刷新） */
export class TidalUnauthorizedError extends Error {
  constructor(message = "tidal access token invalid or expired") {
    super(message);
    this.name = "TidalUnauthorizedError";
  }
}

/** 订阅等级不足错误（403） */
export class TidalForbiddenError extends Error {
  constructor(message = "tidal subscription tier insufficient") {
    super(message);
    this.name = "TidalForbiddenError";
  }
}

/**
 * 同步读取当前凭证（供 song_url 模块在拉流时检查订阅等级）
 *
 * 注意：safeStorage 解密是同步操作，不阻塞主进程
 */
export const getCurrentTidalCredentials = (): TidalTokenPayload | null => {
  return getTidalTokenSync();
};

/**
 * 触发一次 token 刷新并落盘
 *
 * 供 request.ts 401 重试逻辑调用；通过动态 import ipc/tidal.ts 避免循环依赖
 * （ipc/tidal.ts 在启动期就 import 了 request.ts 的 tidalPostForm）
 *
 * @returns true 表示刷新成功；false 表示失败
 */
const refreshTidalTokenOnce = async (): Promise<boolean> => {
  const creds = getCurrentTidalCredentials();
  if (!creds?.refreshToken) {
    tidalLog.warn("[ERR-12025-A] Tidal 无 refresh_token，无法刷新");
    return false;
  }
  try {
    // 动态 import 避免循环依赖
    const { refreshAccessToken } = await import("./oauth");
    const { persistRefreshedToken } = await import("@main/ipc/tidal");
    const tokenResp = await refreshAccessToken(creds.refreshToken);
    persistRefreshedToken({
      accessToken: tokenResp.access_token,
      refreshToken: tokenResp.refresh_token || creds.refreshToken,
      expiresAt: Date.now() + tokenResp.expires_in * 1000,
    });
    return true;
  } catch (err) {
    tidalLog.warn("[ERR-12025-A] Tidal token 自动刷新失败:", err);
    // 刷新失败时标记 token 失效，下次 fetchStatus 会感知到
    const { invalidateTidalToken } = await import("@main/ipc/tidal");
    invalidateTidalToken();
    return false;
  }
};

/**
 * 发一次 Tidal API 请求，返回解析后的 JSON body
 *
 * @param url 完整请求 URL（含 query string）
 * @param options 自定义 headers + signal + autoRefresh；Authorization header 会自动注入
 */
export const tidalRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const { autoRefresh = true } = options;

  const doFetch = async (): Promise<T> => {
    const headers: Record<string, string> = {
      "User-Agent": TIDAL_UA,
      Accept: "application/json",
      ...options.headers,
    };

    if (!options.noAuth) {
      const token = getTidalTokenSync();
      if (!token) throw new Error("Tidal access token not available; please login first");
      headers["Authorization"] = `Bearer ${token.accessToken}`;
    }

    const res = await overseasFetch(url, {
      method: "GET",
      headers,
      signal: options.signal ?? AbortSignal.timeout(8000),
    });

    if (res.status === 401) throw new TidalUnauthorizedError();
    if (res.status === 403) throw new TidalForbiddenError();
    if (res.status !== 200) throw new Error(`Tidal HTTP ${res.status}`);

    return (await res.json()) as T;
  };

  try {
    return await doFetch();
  } catch (err) {
    // 非 401 错误直接抛出，由上层 fallback 处理
    if (!(err instanceof TidalUnauthorizedError)) throw err;
    // verifyToken 等显式关闭 autoRefresh 的调用方：直接抛出
    if (!autoRefresh) throw err;

    tidalLog.warn("[ERR-12031-A] Tidal 请求 401，触发 token 刷新重试");
    const refreshed = await refreshTidalTokenOnce();
    if (!refreshed) throw err;
    // 刷新成功后重试一次
    return await doFetch();
  }
};

/**
 * 发 POST 请求（form-urlencoded），用于 OAuth token 交换 / 刷新
 *
 * @param url token 端点
 * @param body form-urlencoded body
 */
export const tidalPostForm = async <T = unknown>(
  url: string,
  body: string,
): Promise<T> => {
  const res = await overseasFetch(url, {
    method: "POST",
    headers: {
      "User-Agent": TIDAL_UA,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    signal: AbortSignal.timeout(10000),
  });

  if (res.status !== 200) {
    const text = await res.text().catch(() => "");
    throw new Error(`Tidal POST HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  return (await res.json()) as T;
};
