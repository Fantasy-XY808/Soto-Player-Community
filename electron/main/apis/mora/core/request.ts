/**
 * mora 请求层
 *
 * 设计：
 * - 海外平台：必须走 overseasFetch（注入代理 dispatcher）
 * - 浏览器伪装 UA + 必备 X-Requested-With + Referer 头（实地验证：缺任一会被风控或返回 HTML）
 * - 8 秒超时；HTTP 非 200 抛错由上层 fallback 处理
 *
 * 真实接口（实地抓包验证）：
 * - 搜索：GET https://mora.jp/search/getResult?keyWord=xxx → JSON
 *   响应 Content-Type 是 text/html 但响应体是合法 JSON，res.json() 可解析
 * - 试听：GET https://mora.jp/listenDownload?materialNo=xxx → JSON
 *   返回 { listenUrl: "签名 CloudFront URL" }，URL 时效约 24h
 *
 * 付费登录用户可选增强：
 * - getMoraTokenSync：从 {configDir}/mora.json 同步读取 cookie/session（safeStorage 加密）
 * - withCredentials=true 时注入 Cookie header，可访问购买曲目元数据
 * - 完整流 D 级不接入（下载商店无流媒体能力）
 */

import { MORA_UA } from "./config";
import { getMoraTokenSync } from "@main/ipc/mora";
import { overseasFetch } from "@main/services/proxyDispatcher";
import type { MoraTokenPayload } from "@shared/types/mora";

interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * 发一次 mora GET 请求，返回解析后的 JSON body；失败直接抛错由上层 fallback 处理
 *
 * 注：mora.jp 的 JSON 接口响应 Content-Type 是 text/html 但响应体是合法 JSON，
 * fetch 的 res.json() 不校验 content-type，直接按 JSON 解析响应体即可。
 *
 * @param url             完整请求 URL（含 query string）
 * @param options         自定义 headers（User-Agent / X-Requested-With / Referer 自动注入）
 * @param withCredentials true 时注入用户 cookie（付费登录用户可访问购买曲目元数据）
 */
export const moraRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
  withCredentials = false,
): Promise<T> => {
  const headers: Record<string, string> = {
    "User-Agent": MORA_UA,
    Accept: "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.8",
    // 实地验证：mora.jp 的 getResult / listenDownload 接口要求 X-Requested-With + Referer
    // 缺任一会被风控判为非 AJAX 请求或返回非 JSON 响应
    "X-Requested-With": "XMLHttpRequest",
    Referer: "https://mora.jp/",
    ...options.headers,
  };
  if (withCredentials) {
    const token = getMoraTokenSync();
    if (!token) throw new Error("mora withCredentials requested but no cookie available");
    headers.Cookie = token.cookie;
  }

  const res = await overseasFetch(url, {
    method: "GET",
    headers,
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw new Error(`mora HTTP ${res.status}`);

  return (await res.json()) as T;
};

/**
 * 同步读取当前付费登录凭据（cookie + nickname）
 *
 * 供 modules/song_url.ts 在付费登录用户调用时检查是否需提示完整流不接入；
 * 试听路径免登录，无需调用此函数。
 *
 * 注意：safeStorage 解密是同步操作，不阻塞主进程
 */
export const getCurrentMoraCredentials = (): MoraTokenPayload | null => {
  return getMoraTokenSync();
};
