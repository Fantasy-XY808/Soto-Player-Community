/**
 * Archive 请求层
 *
 * 设计：
 * - 完全无鉴权：不需要 X-App-Id / token / signature
 * - 海外平台：走 overseasFetch（注入代理 dispatcher）
 * - 8 秒超时；HTTP 非 200 抛错由上层 fallback 处理
 */

import { ARCHIVE_UA } from "./config";
import { overseasFetch } from "@main/services/proxyDispatcher";

interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * 发一次 Archive GET 请求，返回解析后的 JSON body；失败直接抛错由上层 fallback 处理
 *
 * @param url     完整请求 URL（含 query string）
 * @param options 自定义 headers（User-Agent 自动注入）
 */
export const archiveRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const headers: Record<string, string> = {
    "User-Agent": ARCHIVE_UA,
    Accept: "application/json",
    ...options.headers,
  };

  const res = await overseasFetch(url, {
    method: "GET",
    headers,
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw new Error(`Archive HTTP ${res.status}`);

  return (await res.json()) as T;
};
