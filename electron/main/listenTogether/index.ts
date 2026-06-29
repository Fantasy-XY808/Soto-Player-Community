/**
 * 一起听模块统一 API 聚合
 *
 * 将 server / client / session / discovery / level 模块的对外接口集中导出，
 * IPC 层（electron/main/ipc/listenTogether.ts）只依赖本文件，避免分散导入。
 */

import type { ListenTogetherStatus } from "@shared/types/settings";
import type { Track, PlayerState } from "@shared/types/player";
import {
  startHost,
  stopHost,
  broadcastTrackChange,
  broadcastStateChange,
  broadcastSeek,
  broadcastQueueUpdate,
  getRunningHostPort,
} from "./server";
import { joinSession, leaveSession } from "./client";
import {
  enterHostMode,
  exitHostMode,
  enterClientMode,
  exitClientMode,
  onHostTrackChange,
  onHostStateChange,
  onHostSeek,
  onHostQueueUpdate,
  setCurrentIndex,
  subscribeStatus,
  getStatus,
  getRole,
  setClientQueue,
} from "./session";
import { getLocalUserInfo, isLevelSufficient, type LocalUserInfo } from "./level";
import {
  publishService,
  unpublishService,
  browseServices,
  stopBrowse,
  getDiscoveredSessions,
  destroyDiscovery,
  type DiscoveredSession,
} from "./discovery";
import type { UserLevel } from "./protocol";

export {
  startHost,
  stopHost,
  broadcastTrackChange,
  broadcastStateChange,
  broadcastSeek,
  broadcastQueueUpdate,
  getRunningHostPort,
  joinSession,
  leaveSession,
  enterHostMode,
  exitHostMode,
  enterClientMode,
  exitClientMode,
  onHostTrackChange,
  onHostStateChange,
  onHostSeek,
  onHostQueueUpdate,
  setCurrentIndex,
  subscribeStatus,
  getStatus,
  getRole,
  setClientQueue,
  getLocalUserInfo,
  isLevelSufficient,
  publishService,
  unpublishService,
  browseServices,
  stopBrowse,
  getDiscoveredSessions,
  destroyDiscovery,
};
export type { LocalUserInfo, DiscoveredSession, UserLevel, ListenTogetherStatus };

/**
 * 主机端：player 状态变化钩子统一入口
 *
 * 由主进程 player.ts 在状态变化时调用，本函数根据当前角色决定是否广播。
 * @param kind - 事件类型
 * @param payload - 事件负载
 */
export const handlePlayerEvent = (
  kind: "trackChange" | "stateChange" | "seek" | "queueUpdate",
  payload: {
    track?: Track | null;
    position?: number;
    state?: PlayerState;
    queue?: Track[];
    currentIndex?: number;
  },
): void => {
  if (getRole() !== "host") return;
  switch (kind) {
    case "trackChange":
      onHostTrackChange(payload.track ?? null, payload.position ?? 0, payload.state ?? "idle");
      broadcastTrackChange();
      break;
    case "stateChange":
      if (payload.state) {
        onHostStateChange(payload.state);
        const normalized: "playing" | "paused" = payload.state === "playing" ? "playing" : "paused";
        broadcastStateChange(normalized);
      }
      break;
    case "seek":
      if (typeof payload.position === "number") {
        onHostSeek(payload.position);
        broadcastSeek(payload.position);
      }
      break;
    case "queueUpdate":
      if (payload.queue && typeof payload.currentIndex === "number") {
        onHostQueueUpdate(payload.queue, payload.currentIndex);
        broadcastQueueUpdate();
      }
      break;
  }
};

/**
 * 应用退出时统一清理
 */
export const cleanupListenTogether = async (): Promise<void> => {
  try {
    await stopHost();
  } catch {
    // ignore
  }
  try {
    await leaveSession();
  } catch {
    // ignore
  }
  destroyDiscovery();
};
