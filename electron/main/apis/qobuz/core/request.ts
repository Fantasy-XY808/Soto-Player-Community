/**
 * Qobuz 请求层
 *
 * 设计：
 * - 大部分端点 GET，只需 X-App-Id header（无鉴权）
 * - 鉴权端点加 X-User-Auth-Token（从 safeStorage 加密读取，不存明文）
 * - /track/getFileUrl 需要请求签名（直接 MD5，非 HMAC-MD5）
 *
 * 签名明文拼接规则（参考 vitiko98/qobuz-dl 的 qopy.py）：
 *   r_sig = endpoint（去 /）
 *         + 按 key 字典序排序的每对 key+value
 *         + str(unix_ts)
 *         + app_secret
 *   request_sig = md5(r_sig).hexdigest()
 */

import { createHash } from "node:crypto";
import { QOBUZ_APP_ID, QOBUZ_UA } from "./config";
import { getQobuzTokenSync } from "@main/ipc/qobuz";
import { overseasFetch } from "@main/services/proxyDispatcher";
import type { QobuzTokenPayload } from "@shared/types/qobuz";

interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

interface QobuzRawBody {
  status?: string;
  code?: string;
  message?: string | null;
  [key: string]: unknown;
}

/**
 * 发一次 Qobuz GET 请求，返回解析后的 JSON body；失败直接抛错由上层 fallback 处理
 *
 * @param url 完整请求 URL（含 query string）
 * @param options 自定义 headers（X-App-Id 会自动注入；withCredentials=true 时 X-User-Auth-Token 自动注入）
 * @param withCredentials true 时注入用户 user_auth_token
 */
export const qobuzRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
  withCredentials = false,
): Promise<T> => {
  const headers: Record<string, string> = {
    "User-Agent": QOBUZ_UA,
    "X-App-Id": QOBUZ_APP_ID,
    ...options.headers,
  };
  if (withCredentials) {
    const token = getQobuzTokenSync();
    if (!token) throw new Error("Qobuz withCredentials requested but no token available");
    headers["X-User-Auth-Token"] = token.userAuthToken;
  }

  const res = await overseasFetch(url, {
    method: "GET",
    headers,
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw new Error(`Qobuz HTTP ${res.status}`);

  const body = (await res.json()) as QobuzRawBody;
  // Qobuz 错误响应：status="error" + code 字段（如 "400" / "401"）
  if (body.status === "error") {
    throw new Error(`Qobuz API error: code=${body.code ?? "?"} msg=${body.message ?? "?"}`);
  }

  return body as T;
};

/**
 * 构造 Qobuz /track/getFileUrl 签名（直接 MD5，非 HMAC-MD5）
 *
 * @param endpoint 端点（去 /，如 "trackgetFileUrl"）
 * @param params 签名参数（key 字典序排序后拼接 key+value）
 * @param unixTs 当前 unix 时间戳
 * @param appSecret 候选 app_secret
 * @returns 32 位十六进制 MD5 签名
 */
export const signQobuzRequest = (
  endpoint: string,
  params: Record<string, string | number>,
  unixTs: number,
  appSecret: string,
): string => {
  const sortedKeys = Object.keys(params).sort();
  let rSig = endpoint;
  for (const key of sortedKeys) {
    rSig += key + String(params[key]);
  }
  rSig += String(unixTs);
  rSig += appSecret;
  return createHash("md5").update(rSig).digest("hex");
};

/**
 * 同步读取当前凭证（供 song_url 模块在拉流时检查订阅等级）
 *
 * 注意：safeStorage 解密是同步操作，不阻塞主进程
 */
export const getCurrentQobuzCredentials = (): QobuzTokenPayload | null => {
  return getQobuzTokenSync();
};
