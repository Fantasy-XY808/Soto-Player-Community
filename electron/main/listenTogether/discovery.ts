/**
 * mDNS 服务发现
 *
 * - 主机模式：在局域网内发布 `_splayer._tcp` 服务，便于客户端自动发现
 * - 客户端模式：浏览局域网内同类型服务，实时上报上下线
 *
 * 公网/内网穿透场景不走 mDNS（无广播域），由用户手动输入 ws/wss URL；
 * 本模块仅服务于局域网自动发现这一便利场景。
 */

import { Bonjour, type Service, type Browser } from "bonjour-service";
import { ltLog } from "@main/utils/logger";
import type { ListenTogetherDiscoveredSession } from "@shared/types/settings";

/** 服务类型（不含协议后缀） */
const SERVICE_TYPE = "splayer";

/** 发现到的会话条目（UI 列表用） */
export type DiscoveredSession = ListenTogetherDiscoveredSession;

/** Bonjour 实例（懒加载，按需创建/销毁） */
let bonjour: Bonjour | null = null;
/** 已发布的服务实例 */
let publishedService: Service | null = null;
/** 浏览器实例 */
let browser: Browser | null = null;

/** 当前发现的会话列表（按 host:port 去重） */
const discoveredSessions = new Map<string, DiscoveredSession>();

/** 会话发现回调（UI 订阅用） */
type DiscoveryCallback = (sessions: DiscoveredSession[]) => void;
const discoveryCallbacks = new Set<DiscoveryCallback>();

/** 取或创建 Bonjour 实例 */
const getBonjour = (): Bonjour => {
  if (!bonjour) bonjour = new Bonjour();
  return bonjour;
};

/** 通知所有订阅者刷新列表 */
const notifyDiscovery = (): void => {
  const list = Array.from(discoveredSessions.values());
  for (const cb of discoveryCallbacks) {
    try {
      cb(list);
    } catch (err) {
      ltLog.error("发现回调异常:", err);
    }
  }
};

/**
 * 发布主机服务
 * @param name - 主机显示名
 * @param port - 监听端口
 * @param level - 主机级别
 * @param hasPassword - 是否需要口令
 */
export const publishService = (
  name: string,
  port: number,
  level: "default" | "vip",
  hasPassword: boolean,
): void => {
  if (publishedService) {
    try {
      publishedService.stop();
    } catch {
      // ignore
    }
    publishedService = null;
  }
  const inst = getBonjour();
  publishedService = inst.publish({
    name,
    type: SERVICE_TYPE,
    protocol: "tcp",
    port,
    txt: {
      level,
      hasPassword: hasPassword ? "1" : "0",
    },
  });
  ltLog.info(`已发布 mDNS 服务: ${name} :${port} (${level})`);
};

/** 取消发布主机服务 */
export const unpublishService = (): void => {
  if (publishedService) {
    try {
      publishedService.stop();
    } catch {
      // ignore
    }
    publishedService = null;
  }
};

/**
 * 解析服务对象为发现条目
 * @param service - bonjour 服务对象
 */
const toDiscovered = (service: Service): DiscoveredSession | null => {
  const host = service.addresses?.find((a) => !a.includes(":")) ?? service.host;
  if (!host) return null;
  const txt = service.txt ?? {};
  return {
    name: service.name,
    host,
    port: service.port,
    txt: {
      level: txt.level === "vip" ? "vip" : "default",
      hasPassword: txt.hasPassword === "1",
    },
    lastSeen: Date.now(),
  };
};

/**
 * 开始浏览局域网内的会话
 * @param onUpdate - 每次列表变化时回调
 */
export const browseServices = (onUpdate?: DiscoveryCallback): void => {
  if (browser) return;
  if (onUpdate) discoveryCallbacks.add(onUpdate);
  const inst = getBonjour();
  browser = inst.find({ type: SERVICE_TYPE, protocol: "tcp" });
  browser.on("up", (service: Service) => {
    const entry = toDiscovered(service);
    if (!entry) return;
    const key = `${entry.host}:${entry.port}`;
    discoveredSessions.set(key, entry);
    notifyDiscovery();
    ltLog.info(`发现会话: ${entry.name} (${key})`);
  });
  browser.on("down", (service: Service) => {
    const host = service.addresses?.find((a) => !a.includes(":")) ?? service.host;
    if (!host) return;
    const key = `${host}:${service.port}`;
    if (discoveredSessions.delete(key)) notifyDiscovery();
  });
  // 立即投递一次当前快照
  notifyDiscovery();
};

/**
 * 取消浏览
 * @param onUpdate - 之前注册的回调
 */
export const stopBrowse = (onUpdate?: DiscoveryCallback): void => {
  if (onUpdate) discoveryCallbacks.delete(onUpdate);
  if (browser) {
    try {
      browser.stop();
    } catch {
      // ignore
    }
    browser = null;
  }
  if (discoveryCallbacks.size === 0) {
    discoveredSessions.clear();
  }
};

/**
 * 取当前已发现的会话列表快照（IPC 层查询用）
 */
export const getDiscoveredSessions = (): DiscoveredSession[] =>
  Array.from(discoveredSessions.values());

/**
 * 销毁 mDNS 实例（应用退出时调用）
 */
export const destroyDiscovery = (): void => {
  if (publishedService) {
    try {
      publishedService.stop();
    } catch {
      // ignore
    }
    publishedService = null;
  }
  if (browser) {
    try {
      browser.stop();
    } catch {
      // ignore
    }
    browser = null;
  }
  if (bonjour) {
    try {
      bonjour.destroy();
    } catch {
      // ignore
    }
    bonjour = null;
  }
  discoveredSessions.clear();
  discoveryCallbacks.clear();
};
