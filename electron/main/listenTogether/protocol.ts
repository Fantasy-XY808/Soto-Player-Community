/**
 * 一起听协议：定义主机与客户端之间传输的消息类型与序列化辅助
 *
 * 设计要点：
 * - 传输层为 WebSocket（ws/wss），消息以换行分隔的 JSON 文本帧承载
 * - 所有时间字段均以毫秒为单位；serverTime = Date.now() 用于时钟同步与延迟补偿
 * - 协议版本号固化在 hello 中，便于后续升级时的兼容判定
 */

import type { ListenTogetherPermissions, ListenTogetherQueueMode } from "@shared/types/settings";

/** 协议版本 */
export const PROTOCOL_VERSION = 1;

/** 网易云账号级别（与现有 vipType 判定保持一致：0=普通，非 0=VIP） */
export type UserLevel = "default" | "vip";

/** 同步曲目：跨进程最小化的曲目描述，仅包含客户端解析音源所需字段 */
export interface SyncTrack {
  /** 原始曲目 id（网易云歌曲 id / 本地路径 hash / 平台 id） */
  id: string;
  /** 音源类型 */
  source: "netease" | "qqmusic" | "kugou" | "local";
  /** 标题 */
  title: string;
  /** 艺术家（已拼接为展示字符串） */
  artist: string;
  /** 专辑名 */
  album: string;
  /** 时长（毫秒） */
  duration: number;
}

/** 队列切片：根据 queueMode 截取后传输 */
export interface SyncQueueSnapshot {
  /** 队列切片（依据 queueMode：currentOnly 仅 1 首、currentAndNext 2 首、fullQueue 全部） */
  tracks: SyncTrack[];
  /** 当前曲在切片中的索引（0-based） */
  currentIndex: number;
}

/** 客户端 → 主机：握手 */
export interface ClientHelloMessage {
  type: "hello";
  /** 协议版本 */
  protocol: typeof PROTOCOL_VERSION;
  /** 客户端显示名（取自网易云昵称） */
  name: string;
  /** 会话口令 */
  password: string;
  /** 客户端账号级别 */
  level: UserLevel;
}

/** 主机 → 客户端：握手成功 */
export interface ServerWelcomeMessage {
  type: "welcome";
  /** 主机显示名 */
  hostName: string;
  /** 主机级别 */
  hostLevel: UserLevel;
  /** 当前曲目（含播放位置与状态，省一次往返） */
  currentTrack: SyncTrack | null;
  /** 当前位置（毫秒） */
  currentPosition: number;
  /** 当前播放状态 */
  currentState: "playing" | "paused";
  /** 队列快照（按 queueMode 切片） */
  queue: SyncQueueSnapshot | null;
  /** 主机下发的房客权限（客户端据此禁用对应操作） */
  permissions: ListenTogetherPermissions;
  /** 主机发消息时的墙钟时间，用于时钟同步 */
  serverTime: number;
}

/** 主机 → 客户端：握手拒绝 */
export interface ServerRejectMessage {
  type: "reject";
  /** 拒绝原因 */
  reason: "wrong_password" | "level_insufficient" | "protocol_mismatch" | "need_login";
}

/** 主机 → 客户端：曲目切换 */
export interface TrackChangeMessage {
  type: "trackChange";
  track: SyncTrack | null;
  position: number;
  state: "playing" | "paused";
  serverTime: number;
}

/** 主机 → 客户端：播放状态变化 */
export interface StateChangeMessage {
  type: "stateChange";
  state: "playing" | "paused";
  serverTime: number;
}

/** 主机 → 客户端：拖动进度 */
export interface SeekMessage {
  type: "seek";
  position: number;
  serverTime: number;
}

/** 主机 → 客户端：队列更新 */
export interface QueueUpdateMessage {
  type: "queueUpdate";
  queue: SyncQueueSnapshot;
}

/** 主机 → 客户端：周期进度同步（仅 progressMode=interval 时发送） */
export interface PositionSyncMessage {
  type: "positionSync";
  position: number;
  serverTime: number;
}

/** 主机 → 客户端：成员列表同步（含自己在内的所有房客） */
export interface MembersSyncMessage {
  type: "membersSync";
  /** 当前已握手成员（含延迟、级别） */
  members: { id: string; name: string; level: UserLevel; latency: number }[];
}

/** 任一方向：心跳请求 */
export interface PingMessage {
  type: "ping";
  /** 客户端发送时刻，主机原样回传 */
  t: number;
}

/** 任一方向：心跳响应 */
export interface PongMessage {
  type: "pong";
  /** 对应 ping 的 t */
  t: number;
}

/** 客户端 → 主机：回传测量好的单向延迟（RTT/2）
 *  主机端不再用 Date.now() - msg.t 估算，避免时钟不同步导致 0ms 或负值 */
export interface PongBackMessage {
  type: "pongBack";
  /** 客户端算好的单向延迟（毫秒，RTT/2） */
  latency: number;
}

/** 任一方向：断开通知（礼貌关闭前发送） */
export interface ByeMessage {
  type: "bye";
  /** 是否为会话结束（主机主动关闭） */
  graceful: boolean;
}

/** 协议消息联合类型 */
export type Message =
  | ClientHelloMessage
  | ServerWelcomeMessage
  | ServerRejectMessage
  | TrackChangeMessage
  | StateChangeMessage
  | SeekMessage
  | QueueUpdateMessage
  | PositionSyncMessage
  | MembersSyncMessage
  | PingMessage
  | PongMessage
  | PongBackMessage
  | ByeMessage;

/**
 * 序列化消息为 WebSocket 文本帧（追加换行符）
 * @param msg - 协议消息
 * @returns 文本帧
 */
export const encode = (msg: Message): string => `${JSON.stringify(msg)}\n`;

/**
 * 反序列化文本帧为消息数组（容忍尾部多余换行）
 * @param data - 接收到的文本
 * @returns 解析出的消息列表
 */
export const decode = (data: string): Message[] => {
  const lines = data.split("\n").filter((line) => line.length > 0);
  const out: Message[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as Message);
    } catch {
      // 解析失败的帧直接跳过，避免单条坏消息中断会话
    }
  }
  return out;
};

/**
 * 按队列同步模式切片队列
 * @param tracks - 完整队列
 * @param currentIndex - 当前曲索引
 * @param mode - 队列同步模式
 * @returns 切片后的快照
 */
export const sliceQueue = (
  tracks: SyncTrack[],
  currentIndex: number,
  mode: ListenTogetherQueueMode,
): SyncQueueSnapshot => {
  if (mode === "currentOnly") {
    // 越界时返回空切片 + currentIndex:-1，与 session.ts setCurrentIndex/setClientQueue 语义对齐
    // （此前越界返回 currentIndex:0 但 tracks:[]，状态层 setClientQueue 会归一为 -1，
    //   协议层与状态层语义不一致；自描述性差）
    if (currentIndex < 0 || currentIndex >= tracks.length) {
      return { tracks: [], currentIndex: -1 };
    }
    return {
      tracks: [tracks[currentIndex]!],
      currentIndex: 0,
    };
  }
  if (mode === "currentAndNext") {
    // currentIndex 越界（-1 或 >= tracks.length）时返回空切片，避免误返回第一首
    if (currentIndex < 0 || currentIndex >= tracks.length) {
      return { tracks: [], currentIndex: -1 };
    }
    const slice = tracks.slice(currentIndex, currentIndex + 2);
    return { tracks: slice, currentIndex: 0 };
  }
  // fullQueue 模式：保留原始索引（含 -1）
  return { tracks: [...tracks], currentIndex };
};
