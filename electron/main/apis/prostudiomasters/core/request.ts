/**
 * ProStudioMasters 请求层
 *
 * 设计：
 * - 海外平台：必须走 overseasFetch（注入代理 dispatcher）
 * - 浏览器伪装 UA + Accept: application/json
 * - 8 秒超时；HTTP 非 200 抛错由上层 fallback 处理
 * - 签名算法未知：本请求器不内置签名算法
 *   - 仅做 session token 注入（用户录入后自动加 Authorization/Cookie）
 *   - 端点 URL 与签名参数由调用方拼接，本文件不硬编码
 *
 * 三种导出：
 * - psmRequest: JSON 模式（API 调用，可注入凭据）
 * - psmRequestText: 纯文本模式（HTML 抓取，用于搜索 fallback，公开免登录）
 * - getCurrentPsmCredentials: 同步读盘 + 解密（复用 IPC 文件实现）
 */

import { PSM_UA } from "./config";
import { overseasFetch } from "@main/services/proxyDispatcher";
import { getPsmTokenSync } from "@main/ipc/prostudiomasters";
import type { PsmTokenPayload } from "@shared/types/prostudiomasters";

interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * 判定 session token 是 Bearer token 还是 Cookie 串
 * - Cookie 串含 "="（key=value 形式）且通常含 ";"（多个 cookie）或以 "session" 开头
 * - Bearer token 通常是单一无 "=" 的字符串（JWT / 十六进制 / 不透明串）
 *
 * 简化判定：含 "=" 视为 Cookie 串；否则视为 Bearer
 */
const isCookieString = (token: string): boolean => {
  return token.includes("=");
};

/** 构造鉴权 header（Bearer 或 Cookie） */
const buildAuthHeaders = (token: string): Record<string, string> => {
  if (!token) return {};
  if (isCookieString(token)) {
    return { Cookie: token };
  }
  return { Authorization: `Bearer ${token}` };
};

/**
 * 发一次 ProStudioMasters GET 请求，返回解析后的 JSON body；失败直接抛错由上层 fallback 处理
 *
 * @param url             完整请求 URL（含 query string）
 * @param options         自定义 headers（User-Agent 自动注入）
 * @param withCredentials true 时自动注入 Authorization/Cookie（从 safeStorage 加密读取）
 */
export const psmRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
  withCredentials = false,
): Promise<T> => {
  const headers: Record<string, string> = {
    "User-Agent": PSM_UA,
    Accept: "application/json",
    ...options.headers,
  };
  if (withCredentials) {
    const token = getPsmTokenSync();
    if (!token) {
      throw new Error("ProStudioMasters withCredentials requested but no token available");
    }
    Object.assign(headers, buildAuthHeaders(token.sessionToken));
  }

  const res = await overseasFetch(url, {
    method: "GET",
    headers,
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw new Error(`ProStudioMasters HTTP ${res.status}`);

  return (await res.json()) as T;
};

/**
 * 发一次 ProStudioMasters GET 请求，返回纯文本 body（HTML），用于搜索页 fallback
 *
 * 公开免登录：不注入凭据；调用方应仅用于公开网页（如 /search?q=xxx）
 *
 * @param url     完整请求 URL
 * @param options 自定义 headers（User-Agent 自动注入）
 */
export const psmRequestText = async (
  url: string,
  options: FetchOptions = {},
): Promise<string> => {
  const headers: Record<string, string> = {
    "User-Agent": PSM_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
    // 部分 PHP 后端会校验 Referer，避免被风控判为脚本
    Referer: "https://www.prostudiomasters.com/",
    ...options.headers,
  };

  const res = await overseasFetch(url, {
    method: "GET",
    headers,
    signal: options.signal ?? AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw new Error(`ProStudioMasters HTTP ${res.status}`);

  return await res.text();
};

/**
 * 同步读取当前凭证（供 song_url / search 模块按需检查登录态）
 *
 * 注意：safeStorage 解密是同步操作，不阻塞主进程
 */
export const getCurrentPsmCredentials = (): PsmTokenPayload | null => {
  return getPsmTokenSync();
};
