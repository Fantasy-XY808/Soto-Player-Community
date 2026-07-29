/**
 * Bilibili 请求层
 *
 * 设计：
 * - 国内平台：不走 overseasFetch（避免代理服务器屏蔽国内域名），用 Node 原生 fetch
 * - 8 秒超时；HTTP 非 200 抛错由上层 fallback 处理
 * - 每次请求注入：BILI_UA + Referer(https://www.bilibili.com/) + cookie
 *   - 用户登录后 cookie 来自 credentials.ts 落盘文件（含 SESSDATA / bili_jct 等）
 *   - 未登录时回退到 BILI_ANON_COOKIE（buvid3=placeholder）匿名访问
 *   - Referer / cookie 缺失会被 B站风控判为脚本访问
 */

import { BILI_UA, BILI_ANON_COOKIE } from "./config";
import { getBilibiliCookieSync } from "./credentials";

interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * 发一次 Bilibili GET 请求，返回解析后的 JSON body；失败直接抛错由上层 fallback 处理
 *
 * @param url     完整请求 URL（含 query string）
 * @param options 自定义 headers（User-Agent / Referer / Cookie 自动注入）
 */
export const biliRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  // 用户登录后用真实 cookie；否则回退匿名占位
  const userCookie = getBilibiliCookieSync();
  const cookie = userCookie ?? BILI_ANON_COOKIE;

  const headers: Record<string, string> = {
    "User-Agent": BILI_UA,
    Referer: "https://www.bilibili.com/",
    Cookie: cookie,
    Accept: "application/json",
    ...options.headers,
  };

  const res = await fetch(url, {
    method: "GET",
    headers,
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw new Error(`Bilibili HTTP ${res.status}`);

  return (await res.json()) as T;
};
