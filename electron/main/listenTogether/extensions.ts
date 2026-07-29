/**
 * 一起听扩展功能：searchShare / reaction / 双向 queue 同步
 *
 * 参考 x01n fork 的 extensions 实现，针对 Soto_Player 的协议模型做适配：
 * - x01n 使用 room.id 隔离多房间；Soto_Player 单主机单房间，使用模块级状态即可
 * - x01n 通过 hono ws 上下文广播；Soto_Player 通过 server.ts 的 broadcast 函数广播
 * - x01n 的 ListenTogetherQueueItem 包含 addedBy/addedAt；Soto_Player 简化为仅存 SyncTrack，
 *   由消息层（queueSync）携带 byUserId/byUserName 表达来源
 *
 * 三类事件统一通过 dispatchExtensionEvent 推送到订阅器，IPC 层订阅后转发到渲染端。
 */

import { ltLog } from "@main/utils/logger";
import type {
  QueueSyncAction,
  QueueSyncMessage,
  ReactionMessage,
  SearchShareMessage,
  SearchSharedMessage,
  SyncTrack,
} from "./protocol";

/** 扩展事件类型（IPC 层与渲染端共用） */
export type ListenTogetherExtensionEvent =
  | {
      kind: "searchShared";
      platform: string;
      keyword: string;
      results: unknown;
      sharedBy: string;
      sharedByName: string;
      timestamp: number;
    }
  | {
      kind: "reaction";
      emoji: string;
      fromUserId: string;
      fromName: string;
      timestamp: number;
    }
  | {
      kind: "queueSync";
      action: QueueSyncAction;
      track?: SyncTrack;
      index?: number;
      oldIndex?: number;
      newIndex?: number;
      tracks?: SyncTrack[];
      byUserId: string;
      byUserName?: string;
      timestamp: number;
      snapshot?: SyncTrack[];
    };

/** 扩展事件订阅者集合 */
const extensionSubscribers = new Set<(event: ListenTogetherExtensionEvent) => void>();

/**
 * 订阅扩展事件
 * @param fn - 事件回调
 * @returns 取消订阅函数
 */
export const subscribeExtensionEvents = (
  fn: (event: ListenTogetherExtensionEvent) => void,
): (() => void) => {
  extensionSubscribers.add(fn);
  return () => extensionSubscribers.delete(fn);
};

/**
 * 派发扩展事件到所有订阅者
 *
 * 由 server.ts（主机端收到客户端消息时）与 client.ts（客户端收到主机广播时）调用。
 * IPC 层订阅后通过 broadcast 推送到所有窗口的渲染端。
 */
export const dispatchExtensionEvent = (event: ListenTogetherExtensionEvent): void => {
  for (const fn of extensionSubscribers) {
    try {
      fn(event);
    } catch (err) {
      ltLog.error("扩展事件订阅回调异常:", err);
    }
  }
};

/** 房间级共享队列（仅主机端维护完整状态；客户端通过 queueSync.snapshot 增量同步） */
let sharedQueue: SyncTrack[] = [];

/** 取当前共享队列快照（主机端用于构造广播 snapshot；客户端不调用） */
export const getSharedQueue = (): SyncTrack[] => sharedQueue.map((t) => ({ ...t }));

/** 重置共享队列（stopHost / leaveSession 时调用，避免跨会话残留） */
export const resetSharedQueue = (): void => {
  sharedQueue = [];
};

/**
 * 应用队列操作（主机端权威实现）
 *
 * 参考 x01n fork 的 applyQueueAction，简化为单房间模型。返回操作后的队列快照供广播使用。
 * @param action - 操作类型
 * @param params - 操作参数
 * @param byUserId - 操作发起者 ID（仅用于日志）
 * @returns 操作后的队列快照；操作非法时返回 null
 */
export const applyQueueAction = (
  action: QueueSyncAction,
  params: {
    track?: SyncTrack;
    index?: number;
    oldIndex?: number;
    newIndex?: number;
    tracks?: SyncTrack[];
  },
  byUserId: string,
): SyncTrack[] | null => {
  switch (action) {
    case "add": {
      const track = params.track;
      if (!track) {
        ltLog.warn("[extensions] queueSync add 失败：缺少 track");
        return null;
      }
      sharedQueue.push(track);
      break;
    }
    case "remove": {
      const index = params.index;
      if (typeof index !== "number" || index < 0 || index >= sharedQueue.length) {
        ltLog.warn(
          `[extensions] queueSync remove 失败：索引越界 index=${index} length=${sharedQueue.length}`,
        );
        return null;
      }
      sharedQueue.splice(index, 1);
      break;
    }
    case "clear": {
      sharedQueue = [];
      break;
    }
    case "reorder": {
      const from = params.oldIndex;
      const to = params.newIndex;
      if (
        typeof from !== "number" ||
        typeof to !== "number" ||
        from < 0 ||
        from >= sharedQueue.length ||
        to < 0 ||
        to >= sharedQueue.length
      ) {
        ltLog.warn(
          `[extensions] queueSync reorder 失败：索引越界 from=${from} to=${to} length=${sharedQueue.length}`,
        );
        return null;
      }
      const [item] = sharedQueue.splice(from, 1);
      sharedQueue.splice(to, 0, item!);
      break;
    }
    case "set": {
      const tracks = params.tracks;
      if (!Array.isArray(tracks)) {
        ltLog.warn("[extensions] queueSync set 失败：tracks 不是数组");
        return null;
      }
      sharedQueue = tracks.map((t) => ({ ...t }));
      break;
    }
    default: {
      ltLog.warn(`[extensions] queueSync 未知 action: ${action}`);
      return null;
    }
  }
  ltLog.info(
    `[extensions] queueSync ${action} by=${byUserId} -> length=${sharedQueue.length}`,
  );
  return getSharedQueue();
};

/**
 * 构造 queueSync 广播消息（主机端应用操作后调用）
 *
 * 将 applyQueueAction 的结果包装为 QueueSyncMessage，附带 snapshot 下发给客户端。
 */
export const buildQueueSyncBroadcast = (
  original: QueueSyncMessage,
  snapshot: SyncTrack[],
): QueueSyncMessage => ({
  type: "queueSync",
  action: original.action,
  track: original.track,
  index: original.index,
  oldIndex: original.oldIndex,
  newIndex: original.newIndex,
  tracks: original.tracks,
  byUserId: original.byUserId,
  byUserName: original.byUserName,
  timestamp: original.timestamp,
  snapshot,
});

/**
 * 主机端：构造本机发起的 queueSync 消息
 *
 * 主机自身渲染端发起的队列操作，byUserId 固定为 "host"。
 */
export const buildHostQueueSyncMessage = (
  action: QueueSyncAction,
  params: {
    track?: SyncTrack;
    index?: number;
    oldIndex?: number;
    newIndex?: number;
    tracks?: SyncTrack[];
  },
  hostName: string,
): QueueSyncMessage => ({
  type: "queueSync",
  action,
  track: params.track,
  index: params.index,
  oldIndex: params.oldIndex,
  newIndex: params.newIndex,
  tracks: params.tracks,
  byUserId: "host",
  byUserName: hostName,
  timestamp: Date.now(),
});

/**
 * 主机端：构造本机发起的 searchShared 消息（直接广播 + 回投本地）
 */
export const buildHostSearchSharedMessage = (
  platform: string,
  keyword: string,
  results: unknown,
  hostName: string,
): SearchSharedMessage => ({
  type: "searchShared",
  platform,
  keyword,
  results,
  sharedBy: "host",
  sharedByName: hostName,
  timestamp: Date.now(),
});

/**
 * 主机端：构造本机发起的 reaction 消息（直接广播 + 回投本地）
 */
export const buildHostReactionMessage = (
  emoji: string,
  hostName: string,
): ReactionMessage => ({
  type: "reaction",
  emoji,
  fromUserId: "host",
  fromName: hostName,
  timestamp: Date.now(),
});

/**
 * 客户端：构造本机发起的 searchShare 请求消息（发往主机）
 *
 * 不携带 sharedBy / sharedByName，主机收到后基于来源 WebSocket 改写。
 */
export const buildClientSearchShareMessage = (
  platform: string,
  keyword: string,
  results: unknown,
): SearchShareMessage => ({
  type: "searchShare",
  platform,
  keyword,
  results,
  timestamp: Date.now(),
});

/**
 * 客户端：构造本机发起的 reaction 请求消息（发往主机）
 *
 * fromUserId 留空，主机改写为客户端 UUID；fromName 由客户端填本地昵称便于主机日志。
 */
export const buildClientReactionMessage = (
  emoji: string,
  localName: string,
): ReactionMessage => ({
  type: "reaction",
  emoji,
  fromUserId: "",
  fromName: localName,
  timestamp: Date.now(),
});

/**
 * 客户端：构造本机发起的 queueSync 请求消息（发往主机）
 *
 * byUserId 留空，主机改写为客户端 UUID。
 */
export const buildClientQueueSyncMessage = (
  action: QueueSyncAction,
  params: {
    track?: SyncTrack;
    index?: number;
    oldIndex?: number;
    newIndex?: number;
    tracks?: SyncTrack[];
  },
  localName: string,
): QueueSyncMessage => ({
  type: "queueSync",
  action,
  track: params.track,
  index: params.index,
  oldIndex: params.oldIndex,
  newIndex: params.newIndex,
  tracks: params.tracks,
  byUserId: "",
  byUserName: localName,
  timestamp: Date.now(),
});
