/**
 * 一起听相关 IPC
 *
 * - getStatus / onStatus：拉取/订阅会话状态
 * - getLocalUserInfo：查询本地网易云登录态（启动前自检）
 * - startHost / stopHost：主机模式开关
 * - joinSession / leaveSession：客户端模式开关
 * - browseSessions / stopBrowse / onDiscovered / getDiscoveredSessions：mDNS 自动发现
 * - notifyQueueUpdate：渲染端队列变化时主动推送（主机端广播给客户端）
 */

import { ipcMain } from "electron";
import { broadcast } from "@main/utils/broadcast";
import type { ListenTogetherStatus, ListenTogetherSettings } from "@shared/types/settings";
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
  type DiscoveredSession,
} from "@main/listenTogether";
import { store } from "@main/store";

/** 状态推送频道 */
const STATUS_CHANNEL = "listenTogether:status";
/** 会话发现推送频道 */
const DISCOVERED_CHANNEL = "listenTogether:discovered";

/** 已注册的状态订阅者计数（避免重复广播） */
let statusSubscriberCount = 0;
/** 状态订阅取消函数 */
let statusUnsubscribe: (() => void) | null = null;

/** 已注册的发现订阅者计数 */
let discoverySubscriberCount = 0;
/** 发现回调引用（用于 stopBrowse 时移除） */
let discoveryCallback: ((sessions: DiscoveredSession[]) => void) | null = null;

/**
 * 注册一起听 IPC 处理器
 */
export const registerListenTogetherIpc = (): void => {
  // 查询当前状态
  ipcMain.handle("listenTogether:getStatus", (): ListenTogetherStatus => getStatus());

  // 订阅状态变化
  ipcMain.on("listenTogether:onStatus", (event) => {
    if (statusSubscriberCount === 0) {
      statusUnsubscribe = subscribeStatus((status) => {
        broadcast(STATUS_CHANNEL, status, false);
      });
    }
    statusSubscriberCount += 1;
    // 立即投递一次当前状态
    event.sender.send(STATUS_CHANNEL, getStatus());

    // 单连接断开时减少计数
    event.sender.once("destroyed", () => {
      statusSubscriberCount = Math.max(0, statusSubscriberCount - 1);
      if (statusSubscriberCount === 0 && statusUnsubscribe) {
        statusUnsubscribe();
        statusUnsubscribe = null;
      }
    });
  });

  // 取消订阅状态
  ipcMain.on("listenTogether:offStatus", () => {
    statusSubscriberCount = Math.max(0, statusSubscriberCount - 1);
    if (statusSubscriberCount === 0 && statusUnsubscribe) {
      statusUnsubscribe();
      statusUnsubscribe = null;
    }
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
    ): Promise<{ ok: boolean; address: string | null; error?: string }> => {
      const info = await getLocalUserInfo();
      if (!info) {
        return { ok: false, address: null, error: "请先登录网易云账号" };
      }
      const config = store.get("listenTogether") as ListenTogetherSettings;
      const port = config.port;
      const address = await startHost(name, info.level, password, port);
      if (!address) {
        return { ok: false, address: null, error: `端口 ${port} 监听失败` };
      }
      // 发布 mDNS 服务（局域网发现）
      publishService(name, port, info.level, password.length > 0);
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
    async (_event, url: string, password: string): Promise<{ ok: boolean; error?: string }> => {
      const ok = await joinSession(url, password);
      return { ok };
    },
  );

  // 离开会话
  ipcMain.handle("listenTogether:leaveSession", async (): Promise<void> => {
    await leaveSession();
  });

  // 开始浏览局域网会话
  ipcMain.on("listenTogether:browseSessions", (event) => {
    if (discoverySubscriberCount === 0) {
      discoveryCallback = (sessions) => {
        broadcast(DISCOVERED_CHANNEL, sessions, false);
      };
      browseServices(discoveryCallback);
    }
    discoverySubscriberCount += 1;
    // 立即投递一次当前快照
    event.sender.send(DISCOVERED_CHANNEL, getDiscoveredSessions());

    event.sender.once("destroyed", () => {
      discoverySubscriberCount = Math.max(0, discoverySubscriberCount - 1);
      if (discoverySubscriberCount === 0) {
        if (discoveryCallback) stopBrowse(discoveryCallback);
        discoveryCallback = null;
      }
    });
  });

  // 停止浏览
  ipcMain.on("listenTogether:stopBrowse", () => {
    discoverySubscriberCount = Math.max(0, discoverySubscriberCount - 1);
    if (discoverySubscriberCount === 0) {
      if (discoveryCallback) stopBrowse(discoveryCallback);
      discoveryCallback = null;
    }
  });

  // 一次性查询当前已发现的会话
  ipcMain.handle("listenTogether:getDiscoveredSessions", (): DiscoveredSession[] =>
    getDiscoveredSessions(),
  );

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
