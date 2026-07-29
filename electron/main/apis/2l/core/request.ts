/**
 * 2L 请求层
 *
 * 设计：
 * - 海外平台：必须走 overseasFetch（注入代理 dispatcher）
 * - 浏览器伪装 UA + 8 秒超时
 * - HTTP 非 200 抛错由上层 fallback 处理
 *
 * 两个请求器：
 * - twoLRequest      JSON 模式（Accept: application/json，返回 res.json()）
 * - twoLRequestText  HTML 模式（Accept: text/html，返回 res.text()）—— 用于解析 /hires/index.html 静态文件列表
 */

import { TWO_L_UA } from "./config";
import { overseasFetch } from "@main/services/proxyDispatcher";

interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const buildHeaders = (extra?: Record<string, string>): Record<string, string> => ({
  "User-Agent": TWO_L_UA,
  ...extra,
});

/**
 * 发一次 2L GET 请求，返回解析后的 JSON body；失败直接抛错由上层 fallback 处理
 *
 * @param url     完整请求 URL（含 query string）
 * @param options 自定义 headers（User-Agent 自动注入）
 */
export const twoLRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const headers = buildHeaders({ Accept: "application/json", ...options.headers });

  const res = await overseasFetch(url, {
    method: "GET",
    headers,
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw new Error(`2L HTTP ${res.status}`);

  return (await res.json()) as T;
};

/**
 * 发一次 2L GET 请求，返回纯文本（HTML）；失败直接抛错由上层 fallback 处理
 *
 * 用于解析 /hires/index.html 静态文件列表，提取 FLAC/DXD/DSD 直链
 *
 * @param url     完整请求 URL
 * @param options 自定义 headers（User-Agent 自动注入）
 */
export const twoLRequestText = async (
  url: string,
  options: FetchOptions = {},
): Promise<string> => {
  const headers = buildHeaders({ Accept: "text/html,application/xhtml+xml", ...options.headers });

  const res = await overseasFetch(url, {
    method: "GET",
    headers,
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw new Error(`2L HTTP ${res.status}`);

  return await res.text();
};
