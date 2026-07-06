/**
 * 一起听相关 IPC
 *
 * - getStatus / onStatus：拉取/订阅会话状态
 * - getLocalUserInfo：查询本地网易云登录态（启动前自检）
 * - startHost / stopHost：主机模式开关
 * - joinSession / leaveSession：客户端模式开关
 * - browseSessions / stopBrowse / onDiscovered / getDiscoveredSessions：mDNS 自动发现
 * - notifyQueueUpdate / notifyTrackChange：渲染端主动推送
 */

import { ipcMain, type WebContents } from "electron";
import { broadcast } from "@main/utils/broadcast";
import type {
  ListenTogetherStatus,
  ListenTogetherSettings,
  ListenTogetherPermissions,
} from "@shared/types/settings";
import type { Track } from "@shared/types/player";
import {
  startHost,
  stopHost,
  joinSession,
  leaveSession,
  subscribeStatus,
  getStatus,
  getLocalUserInfo,
  handlePlayerEvent,
  publishService,
  unpublishService,
  browseServices,
  stopBrowse,
  getDiscoveredSessions,
  getEasyTierStatus,
  type DiscoveredSession,
} from "@main/listenTogether";
import { store } from "@main/store";

/** 状态推送频道 */
const STATUS_CHANNEL = "listenTogether:status";
/** 会话发现推送频道 */
const DISCOVERED_CHANNEL = "listenTogether:discovered";

/**
 * 已注册状态订阅的 sender 集合
 *
 * 此前用全局计数器在多窗口场景下错乱（A 窗口关闭导致 B 窗口收不到推送）。
 * 改为按 WebContents 跟踪，每个 sender 独立持有，destroyed 时移除。
 */
const statusSenders = new Set<WebContents>();
/** 状态订阅取消函数（首个 sender 注册时建立，最后一个 sender 离开时释放） */
let statusUnsubscribe: (() => void) | null = null;

/**
 * 已注册发现订阅的 sender 集合（同上，按 WebContents 跟踪）
 */
const discoverySenders = new Set<WebContents>();
/** 发现回调引用（用于 stopBrowse 时移除） */
let discoveryCallback: ((sessions: DiscoveredSession[]) => void) | null = null;

/**
 * 注册状态订阅 sender（首个时建立全局订阅）
 * @returns true 表示已通过 subscribeStatus 立即触发 broadcast 投递了当前状态，
 *          调用方应跳过显式 sender.send 以避免重复；false 表示需调用方显式投递
 */
const addStatusSender = (sender: WebContents): boolean => {
  statusSenders.add(sender);
  if (statusUnsubscribe) return false;
  statusUnsubscribe = subscribeStatus((status) => {
    broadcast(STATUS_CHANNEL, status, false);
  });
  // 首 sender：subscribeStatus 内部已立即调用 fn(buildStatus()) 触发 broadcast，
  // 当前 sender 已收到一次状态，调用方无需再显式 send
  return true;
};

/** 移除状态订阅 sender（最后一个时释放全局订阅） */
const removeStatusSender = (sender: WebContents): void => {
  statusSenders.delete(sender);
  if (statusSenders.size === 0 && statusUnsubscribe) {
    statusUnsubscribe();
    statusUnsubscribe = null;
  }
};

/**
 * 注册发现订阅 sender
 * @returns true 表示 browseServices 末尾的 notifyDiscovery 已触发 broadcast，
 *          调用方应跳过显式 sender.send 以避免重复；false 表示需调用方显式投递
 */
const addDiscoverySender = (sender: WebContents): boolean => {
  discoverySenders.add(sender);
  if (discoveryCallback) return false;
  discoveryCallback = (sessions) => {
    broadcast(DISCOVERED_CHANNEL, sessions, false);
  };
  browseServices(discoveryCallback);
  // 首 sender：browseServices 末尾 notifyDiscovery 已触发所有回调（含新 callback），
  // broadcast 已向所有窗口投递一次当前快照，调用方无需再显式 send
  return true;
};

/** 移除发现订阅 sender */
const removeDiscoverySender = (sender: WebContents): void => {
  discoverySenders.delete(sender);
  if (discoverySenders.size === 0) {
    if (discoveryCallback) stopBrowse(discoveryCallback);
    discoveryCallback = null;
  }
};

/**
 * 注册一起听 IPC 处理器
 */
export const registerListenTogetherIpc = (): void => {
  // 查询当前状态
  ipcMain.handle("listenTogether:getStatus", (): ListenTogetherStatus => getStatus());

  // 订阅状态变化
  ipcMain.on("listenTogether:onStatus", (event) => {
    // 首 sender：subscribeStatus 内部立即触发 broadcast，无需再显式 send
    // 后续 sender：subscribeStatus 未再次触发，需显式投递当前状态
    const alreadyBroadcast = addStatusSender(event.sender);
    if (!alreadyBroadcast) {
      event.sender.send(STATUS_CHANNEL, getStatus());
    }

    // 单连接断开时移除
    event.sender.once("destroyed", () => {
      removeStatusSender(event.sender);
    });
  });

  // 取消订阅状态
  ipcMain.on("listenTogether:offStatus", (event) => {
    removeStatusSender(event.sender);
  });

  // 查询本地网易云登录态
  ipcMain.handle("listenTogether:getLocalUserInfo", () => getLocalUserInfo());

  // 启动主机模式
  ipcMain.handle(
    "listenTogether:startHost",
    async (
      _event,
      name: string,
      password: string,
      permissions: ListenTogetherPermissions,
    ): Promise<{ ok: boolean; address: string | null; error?: string }> => {
      // 未登录时仍允许启动主机，按 default 级别发布；用户可在登录后再重启主机切换为 vip
      // 此前的"未登录即拒绝"会让只想用本地音源的用户完全无法使用一起听
      const info = await getLocalUserInfo();
      const level = info?.level ?? "default";
      const displayName = name?.trim() || info?.name || "主机";
      const config = store.get("listenTogether") as ListenTogetherSettings;
      const port = config.port;
      const address = await startHost(displayName, level, password, port, permissions);
      if (!address) {
        // 优先透传 EasyTier 错误（如二进制缺失）
        const etError = getEasyTierStatus().error;
        return {
          ok: false,
          address: null,
          error: etError ?? `端口 ${port} 监听失败`,
        };
      }
      // 发布 mDNS 服务（局域网发现）。await 保证旧服务真正注销后才发布新服务，
      // 避免短时间内 stopHost→startHost 时 mDNS 名称冲突导致发布失败。
      await publishService(displayName, port, level, password.length > 0);
      return { ok: true, address };
    },
  );

  // 停止主机模式
  ipcMain.handle("listenTogether:stopHost", async (): Promise<void> => {
    unpublishService();
    await stopHost();
  });

  // 加入会话
  ipcMain.handle(
    "listenTogether:joinSession",
    async (
      _event,
      url: string,
      password: string,
      shareCode?: string,
    ): Promise<{ ok: boolean; error?: string }> => {
      const ok = await joinSession(url, password, shareCode);
      return { ok };
    },
  );

  // 离开会话
  ipcMain.handle("listenTogether:leaveSession", async (): Promise<void> => {
    await leaveSession();
  });

  // 开始浏览局域网会话
  ipcMain.on("listenTogether:browseSessions", (event) => {
    // 首 sender：browseServices 末尾 notifyDiscovery 已触发 broadcast，无需再显式 send
    // 后续 sender：未触发广播，需显式投递当前快照
    const alreadyBroadcast = addDiscoverySender(event.sender);
    if (!alreadyBroadcast) {
      event.sender.send(DISCOVERED_CHANNEL, getDiscoveredSessions());
    }

    event.sender.once("destroyed", () => {
      removeDiscoverySender(event.sender);
    });
  });

  // 停止浏览
  ipcMain.on("listenTogether:stopBrowse", (event) => {
    removeDiscoverySender(event.sender);
  });

  // 一次性查询当前已发现的会话
  ipcMain.handle("listenTogether:getDiscoveredSessions", (): DiscoveredSession[] =>
    getDiscoveredSessions(),
  );

  // 查询 EasyTier 状态（主机模式用于展示虚拟 IP）
  ipcMain.handle("listenTogether:getEasyTierStatus", () => getEasyTierStatus());

  // 渲染端推送队列变化（主机端用于广播给客户端）
  ipcMain.on("listenTogether:notifyQueueUpdate", (_event, queue: Track[], currentIndex: number) => {
    handlePlayerEvent("queueUpdate", { queue, currentIndex });
  });

  // 渲染端推送曲目切换（用于 player:load 之外的场景，例如客户端首次加入后主机已就绪）
  // 主机端通常直接由 player.ts 调用 handlePlayerEvent 触发广播；本通道作为冗余兜底
  ipcMain.on(
    "listenTogether:notifyTrackChange",
    (_event, track: Track | null, position: number, state: "playing" | "paused") => {
      handlePlayerEvent("trackChange", { track, position, state });
    },
  );
};
