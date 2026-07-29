/**
 * 海外音源平台 HTTP 代理 dispatcher 管理
 *
 * 设计：
 * - 仅对海外音源平台（Qobuz / Tidal / mora / Internet Archive 等）启用代理 dispatcher
 * - 国内平台（kugou / qqmusic / netease / unblock）保持直连，避免代理服务器屏蔽国内域名
 * - 通过 `overseasFetch` 函数封装 undici fetch + dispatcher，海外平台 request.ts 调用
 * - Clash 控制器（127.0.0.1:9097）可用于自动探测代理端口，启动期调用一次
 *
 * 与 engine.ts 的 setProxy 区别：
 * - engine.ts 的 setProxy 作用于 Rust 原生播放器（ureq::Proxy），用于音频流拉取
 * - 本模块的 dispatcher 作用于主进程 Node fetch，用于 metadata API 调用
 * - 两者互补，需同时调用
 */

import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { store } from "@main/store";
import { coreLog } from "@main/utils/logger";
import { setProxy } from "@main/services/engine";
import type { ProxySettings } from "@shared/types/settings";

/** Clash 控制器地址（用户已开启 VPN） */
const CLASH_CONTROLLER_URL = "http://127.0.0.1:9097";
const CLASH_CONTROLLER_SECRET = "set-your-secret";

/**
 * 单个 ProxyAgent 的并发连接上限
 *
 * undici ProxyAgent 默认 connections=null（无上限），高并发元数据拉取时
 * 可能瞬间打开大量 TCP 连接打满代理或触发对方限流。32 足以覆盖正常切歌+批量元数据场景。
 */
const PROXY_CONNECTIONS_LIMIT = 32;

/** 缓存的 ProxyAgent，system.proxy 变更时失效 */
let cachedProxyAgent: ProxyAgent | undefined;
let cachedProxyKey: string | undefined;

/**
 * 把 ProxySettings 转为 undici ProxyAgent
 * @returns ProxyAgent；protocol=off 或 host 为空时返回 undefined（调用方走默认直连）
 */
export const buildProxyAgent = (proxy: ProxySettings): ProxyAgent | undefined => {
  if (proxy.protocol === "off" || !proxy.host) return undefined;
  const proto = proxy.protocol === "socks" ? "socks5" : proxy.protocol;
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : "";
  const uri = `${proto}://${auth}${proxy.host}:${proxy.port}`;
  return new ProxyAgent({ uri, connections: PROXY_CONNECTIONS_LIMIT });
};

/**
 * 取当前海外平台应使用的 dispatcher
 *
 * 缓存策略：相同 proxy 配置复用 ProxyAgent，system.proxy 变更时调 invalidateProxyCache。
 * @returns ProxyAgent（启用代理时）或 undefined（关闭代理时，调用方走 undici 默认直连）
 */
export const getOverseasDispatcher = (): Dispatcher | undefined => {
  const proxy = store.get("system.proxy") as ProxySettings;
  const key = `${proxy.protocol}|${proxy.host}|${proxy.port}|${proxy.username ?? ""}|${proxy.password ?? ""}`;
  if (cachedProxyKey === key) {
    return cachedProxyAgent;
  }
  // 配置变化：销毁旧 agent，重建
  if (cachedProxyAgent) {
    try {
      cachedProxyAgent.close();
    } catch {
      // 关闭失败忽略，undici 内部会 GC
    }
  }
  cachedProxyAgent = buildProxyAgent(proxy);
  cachedProxyKey = cachedProxyAgent ? key : undefined;
  return cachedProxyAgent;
};

/**
 * 清空缓存的 ProxyAgent（system.proxy 变更时调用）
 */
export const invalidateProxyCache = (): void => {
  if (cachedProxyAgent) {
    try {
      cachedProxyAgent.close();
    } catch {
      // 忽略
    }
  }
  cachedProxyAgent = undefined;
  cachedProxyKey = undefined;
};

/**
 * 海外平台专用 fetch：自动注入代理 dispatcher
 *
 * 与 Node 原生 fetch 签名兼容，海外平台 request.ts 用此函数替代原生 fetch。
 * 类型上沿用 undici fetch 类型（支持 dispatcher 选项）。
 */
export const overseasFetch: typeof undiciFetch = (input, init) => {
  const dispatcher = getOverseasDispatcher();
  return undiciFetch(input, { ...init, dispatcher });
};

interface ClashConfigsResp {
  "mixed-port"?: number;
  "port"?: number;
  "socks-port"?: number;
  mode?: string;
}

/**
 * 探测 Clash 控制器是否可达
 * @returns Clash configs 响应（含 mixed-port / port / socks-port）或 null
 */
const probeClashController = async (): Promise<ClashConfigsResp | null> => {
  try {
    const res = await undiciFetch(`${CLASH_CONTROLLER_URL}/configs`, {
      headers: { Authorization: `Bearer ${CLASH_CONTROLLER_SECRET}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ClashConfigsResp;
  } catch {
    return null;
  }
};

/**
 * 启动期初始化：如果 system.proxy 为 off 但 Clash 控制器可达，自动配置代理
 *
 * 用户已开启 VPN（Clash 9097 控制器），但 Soto Player 默认 protocol=off，
 * 此函数探测 Clash 实际监听端口并自动写入 system.proxy，使海外平台 fetch 自动走代理。
 *
 * 用户已显式配置代理时不覆盖。
 */
export const initProxyFromClash = async (): Promise<void> => {
  const current = store.get("system.proxy") as ProxySettings;
  if (current.protocol !== "off" && current.host) {
    coreLog.info("[ERR-90001-A] 用户已显式配置代理，跳过 Clash 自动探测");
    invalidateProxyCache();
    return;
  }

  const clash = await probeClashController();
  if (!clash) {
    coreLog.info("[ERR-90001-B] Clash 控制器不可达，跳过自动代理配置（海外平台将直连）");
    return;
  }

  const port = clash["mixed-port"] ?? clash["port"] ?? clash["socks-port"] ?? 7890;
  const protocol = clash["socks-port"] && !clash["mixed-port"] && !clash["port"] ? "socks" : "http";
  const autoConfig: ProxySettings = {
    protocol,
    host: "127.0.0.1",
    port,
    username: "",
    password: "",
  };
  store.set("system.proxy", autoConfig);
  invalidateProxyCache();
  // 同步代理到 Rust 原生引擎（ureq::Proxy），否则海外音源音频流加载会直连失败
  setProxy(autoConfig);
  coreLog.info(
    `[ERR-90001-C] 已从 Clash 控制器自动配置代理: ${protocol}://127.0.0.1:${port} mode=${clash.mode ?? "?"}（已同步到原生引擎）`,
  );
};
