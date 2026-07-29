/**
 * undici ProxyAgent 网络代理
 *
 * 与 utils/proxy.ts 的差异：
 * - proxy.ts 仅提供 getNetworkProxyUrl / testNetworkProxy，没有 fetch 包装
 * - fetchProxy.ts 提供 fetchWithProxy，关闭代理时等价原生 fetch，开启代理时注入 undici dispatcher
 *
 * 适配 Soto 现有 system.proxy 配置（5 字段：protocol/host/port/username/password）：
 * - protocol="off" 或 host 为空时返回 null，调用方走原生 fetch
 * - "http" / "https" 走 undici ProxyAgent
 * - "socks" 协议在 URL 中转为 "socks5"；当前 undici v6 不导出 Socks5ProxyAgent，
 *   socks5 配置只能降级为直连（与 utils/proxy.ts 行为一致），等升级 undici 后再启用
 */

import { store } from "@main/store";
import { systemLog } from "@main/utils/logger";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import type { Dispatcher } from "undici";
import type { ProxySettings } from "../../../shared/types/settings.js";

const PROXY_TEST_URL = "https://www.baidu.com";

let proxyAgent: Dispatcher | undefined;
let proxyAgentUrl = "";

const isManualProxyProtocol = (value: string): value is "http" | "https" | "socks" =>
  value === "http" || value === "https" || value === "socks";

/**
 * 当前手动代理 URL；off 或配置无效时返回 null，保持原生直连行为
 *
 * 与 utils/proxy.ts 的 getNetworkProxyUrl 区别：这里返回 null 而非空串，
 * 让 fetchWithProxy 能区分"未启用代理"与"代理 URL 解析失败"
 */
export const getNetworkProxyUrl = (): string | null => {
  const config = store.get("system.proxy") as ProxySettings;
  if (!isManualProxyProtocol(config.protocol)) return null;
  const host = config.host.trim();
  const port = Number(config.port);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const proto = config.protocol === "socks" ? "socks5" : config.protocol;
  const auth = config.username
    ? `${encodeURIComponent(config.username)}:${encodeURIComponent(config.password ?? "")}@`
    : "";
  return `${proto}://${auth}${host}:${port}`;
};

/**
 * 取或建对应 URL 的 Dispatcher；URL 未变化时复用旧实例，避免每次请求都新建连接池
 *
 * socks5：undici v6 不导出 Socks5ProxyAgent，这里返回 undefined 让调用方走原生 fetch
 */
const getProxyDispatcher = (): Dispatcher | undefined => {
  const url = getNetworkProxyUrl();
  if (!url) return undefined;
  if (url.startsWith("socks5://")) {
    if (proxyAgent) {
      proxyAgent.close().catch(() => {});
      proxyAgent = undefined;
      proxyAgentUrl = "";
    }
    systemLog.warn("[fetchProxy] socks5 暂未支持，降级直连");
    return undefined;
  }
  if (!proxyAgent || proxyAgentUrl !== url) {
    proxyAgent?.close().catch(() => {});
    proxyAgent = new ProxyAgent(url);
    proxyAgentUrl = url;
    systemLog.info(`[fetchProxy] node fetch proxy=${url}`);
  }
  return proxyAgent;
};

/**
 * Node fetch 包装：关闭代理时完全等价于原生 fetch，开启代理时注入 undici dispatcher
 *
 * 用于海外音源（Qobuz / Tidal / mora 等）在 main 进程发出的 HTTP 请求，
 * 让 system.proxy 配置对主进程代码透明生效
 */
export const fetchWithProxy = (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const dispatcher = getProxyDispatcher();
  if (!dispatcher) return fetch(input, init);
  // undici fetch 的 init 类型与 DOM fetch 不完全兼容，做一次结构化透传
  return undiciFetch(input as string | URL, {
    ...(init as RequestInit),
    dispatcher,
  } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
};

/**
 * 测试当前代理是否可用
 *
 * 用 baidu.com 探活，8 秒超时；代理未启用时直接返回 false
 */
export const testNetworkProxy = async (): Promise<boolean> => {
  if (!getNetworkProxyUrl()) return false;
  try {
    const res = await fetchWithProxy(PROXY_TEST_URL, {
      signal: AbortSignal.timeout(8_000),
      method: "HEAD",
    });
    return res.ok;
  } catch (err) {
    systemLog.warn("[fetchProxy] test failed", err);
    return false;
  }
};
