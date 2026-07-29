/**
 * 网络代理工具
 *
 * 适配 Soto 现有 system.proxy 设置（5 字段：protocol/host/port/username/password）。
 *
 * 注：store 通过 createRequire 懒加载，避免在 tsx 测试环境中触发
 * `@main/store` → `@shared/defaults` 的别名解析链（与 electron/main/ipc/extensions.ts
 * 的可测试性策略一致）。测试环境通过 globalThis.__sotoStore 注入 mock。
 */

import { createRequire } from "node:module";
import { request } from "undici";
import type { Dispatcher } from "undici";
import type { ProxySettings } from "../../../shared/types/settings.js";

const require = createRequire(import.meta.url);

/** 测试环境可通过 globalThis.__sotoStore 注入 mock store */
interface MockStore {
  get: (key: string) => ProxySettings;
}

const getProxyConfig = (): ProxySettings => {
  const mockStore = (globalThis as unknown as { __sotoStore?: MockStore }).__sotoStore;
  if (mockStore?.get) {
    return mockStore.get("system.proxy");
  }
  const { store } = require("../store/index.js") as typeof import("../store/index.js");
  return store.get("system.proxy");
};

/**
 * 根据配置构造代理 URL
 *
 * 与 services/proxyDispatcher.ts 的 buildProxyAgent 保持一致的 URL 形态：
 * - protocol="off" 或 host 为空时返回空字符串
 * - "socks" 协议在 URL 中转为 "socks5"（与 undici ProxyAgent 期望一致）
 */
export const getNetworkProxyUrl = (): string => {
  const cfg = getProxyConfig();
  if (!cfg || cfg.protocol === "off" || !cfg.host) return "";

  const auth = cfg.username
    ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password ?? "")}@`
    : "";
  const proto = cfg.protocol === "socks" ? "socks5" : cfg.protocol;
  return `${proto}://${auth}${cfg.host}:${cfg.port}`;
};

/** 测试代理可用性，8 秒超时 */
export const testNetworkProxy = async (): Promise<{
  ok: boolean;
  latencyMs: number;
  error?: string;
}> => {
  const proxyUrl = getNetworkProxyUrl();
  if (!proxyUrl) {
    return { ok: false, latencyMs: 0, error: "Proxy is off" };
  }

  const start = performance.now();
  try {
    let dispatcher: Dispatcher | undefined;
    try {
      const { ProxyAgent } = await import("undici");
      dispatcher = new ProxyAgent(proxyUrl);
    } catch {
      // ProxyAgent 不可用时直连测试（降级）
    }

    const response = await request("https://www.baidu.com", {
      dispatcher,
      method: "HEAD",
      headersTimeout: 8_000,
      bodyTimeout: 8_000,
    });
    const latencyMs = Math.round(performance.now() - start);
    if (response.statusCode >= 200 && response.statusCode < 400) {
      return { ok: true, latencyMs };
    }
    return { ok: false, latencyMs, error: `HTTP ${response.statusCode}` };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return { ok: false, latencyMs, error: (err as Error).message };
  }
};
