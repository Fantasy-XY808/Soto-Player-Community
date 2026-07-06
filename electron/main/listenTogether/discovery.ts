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
const SERVICE_TYPE = "soto-player";

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
 *
 * 此前同步调用 publishedService.stop() 后立即 publish，旧服务可能未真正注销，
 * 新服务可能因名称冲突而上线失败（bonjour-service 内部异步）。
 * 改为返回 Promise，stop 完成后才 publish；调用方 await 即可避免竞态。
 *
 * 超时兜底：publishedService.stop(callback) 的回调由 bonjour-service 内部触发，
 * 极端情况下（socket 异常 / 库 bug）callback 可能永不触发，导致 Promise 永久 hang，
 * 调用方 startHost 会卡死。加 1s 超时强制 resolve。
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
): Promise<void> => {
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve();
    };
    // 1s 超时兜底：bonjour-service stop callback 永不触发时强制推进
    const timer = setTimeout(() => {
      if (!done) {
        ltLog.warn("mDNS 旧服务停止超时，强制推进 publish");
        publishedService = null;
        doPublish();
      }
    }, 1000);

    if (publishedService) {
      try {
        publishedService.stop(() => {
          if (done) return;
          publishedService = null;
          doPublish();
        });
        return;
      } catch (err) {
        ltLog.warn("停止旧 mDNS 服务异常:", err);
        publishedService = null;
      }
    }
    doPublish();

    function doPublish(): void {
      try {
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
      } catch (err) {
        ltLog.error("发布 mDNS 服务失败:", err);
      } finally {
        finish();
      }
    }
  });
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
 *
 * browser.on("up")/("down") 此前未包裹 try/catch：bonjour-service 在某些异常
 * 网络环境下会 emit 异常 service 对象（字段缺失），导致回调抛错后 browser 直接挂掉。
 * 包裹后单个异常不再影响整体浏览，仅记录日志。
 * @param onUpdate - 每次列表变化时回调
 */
export const browseServices = (onUpdate?: DiscoveryCallback): void => {
  if (onUpdate) discoveryCallbacks.add(onUpdate);
  // 已有 browser：仅追加回调，不重复创建
  if (browser) {
    notifyDiscovery();
    return;
  }
  // inst.find 抛错时（socket 已被占用 / 权限不足等）需捕获，避免 IPC 层
  // addDiscoverySender 抛错导致 event.sender.once("destroyed", ...) 永不注册，
  // 进而 discoverySenders 中残留已 destroyed 的 WebContents、browser 永不停止
  try {
    const inst = getBonjour();
    browser = inst.find({ type: SERVICE_TYPE, protocol: "tcp" });
  } catch (err) {
    ltLog.error("启动 mDNS 浏览失败:", err);
    browser = null;
    notifyDiscovery();
    return;
  }
  browser.on("up", (service: Service) => {
    try {
      const entry = toDiscovered(service);
      if (!entry) return;
      const key = `${entry.host}:${entry.port}`;
      discoveredSessions.set(key, entry);
      notifyDiscovery();
      ltLog.info(`发现会话: ${entry.name} (${key})`);
    } catch (err) {
      ltLog.warn("处理 mDNS up 事件异常:", err);
    }
  });
  browser.on("down", (service: Service) => {
    try {
      const host = service.addresses?.find((a) => !a.includes(":")) ?? service.host;
      if (!host) return;
      const key = `${host}:${service.port}`;
      if (discoveredSessions.delete(key)) notifyDiscovery();
    } catch (err) {
      ltLog.warn("处理 mDNS down 事件异常:", err);
    }
  });
  // 立即投递一次当前快照
  notifyDiscovery();
};

/**
 * 取消浏览
 *
 * 引用计数：仅当 discoveryCallbacks 为空（最后一个订阅者退出）时才真正停止 browser。
 * 此前只要任意一个调用方 stopBrowse 就无条件 browser.stop()，导致多窗口场景下
 * 一个窗口关闭后另一个窗口的发现列表也停止刷新。
 * @param onUpdate - 之前注册的回调
 */
export const stopBrowse = (onUpdate?: DiscoveryCallback): void => {
  if (onUpdate) discoveryCallbacks.delete(onUpdate);
  if (discoveryCallbacks.size === 0) {
    if (browser) {
      try {
        browser.stop();
      } catch {
        // ignore
      }
      browser = null;
    }
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
