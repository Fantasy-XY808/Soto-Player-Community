/**
 * 一起听会话状态机
 *
 * 职责：
 * - 维护当前角色（idle / host / client）
 * - 维护当前会话的曲目、播放状态、队列快照，供主机广播与客户端回放共用
 * - 暴露 player 事件钩子，由主进程 player.ts 在状态变化时调用
 * - 暴露客户端入口的 apply* 系列函数，将远端指令转交本地播放器
 *
 * 与播放器的耦合保持单向：本模块只读 player 状态、写入 player 控制，
 * 不订阅 player 内部事件，避免循环依赖。
 */

import type { Track, PlayerState } from "@shared/types/player";
import type {
  ListenTogetherSettings,
  ListenTogetherMember,
  ListenTogetherStatus,
} from "@shared/types/settings";
import { store } from "@main/store";
import { getPlayer } from "@main/services/engine";
import { ltLog } from "@main/utils/logger";
import { PROTOCOL_VERSION, sliceQueue, type SyncTrack, type UserLevel } from "./protocol";

/** 当前角色 */
let role: "idle" | "host" | "client" = "idle";

/** 主机模式：本地账号信息 */
let hostInfo: { name: string; level: UserLevel } | null = null;
/** 主机模式：会话口令 */
let hostPassword: string | null = null;
/** 主机模式：监听端口 */
let hostPort: number | null = null;
/** 主机模式：监听地址 */
let hostAddress: string | null = null;
/** 主机模式：已连接成员（按连接 id 索引） */
const hostMembers = new Map<string, ListenTogetherMember>();

/** 客户端模式：连接的主机 URL */
let clientUrl: string | null = null;
/** 客户端模式：主机名称 */
let clientHostName: string | null = null;
/** 客户端模式：单向延迟（毫秒） */
let clientLatency = 0;
/** 客户端模式：最近一次错误（用于 UI 提示） */
let clientLastError: string | null = null;

/** 当前曲目（主机与客户端共用） */
let currentTrack: Track | null = null;
/** 当前播放状态 */
let currentState: PlayerState = "idle";
/** 当前位置（毫秒） */
let currentPosition = 0;
/** 队列快照（仅主机维护完整队列；客户端按 queueMode 接收切片） */
let currentQueue: Track[] = [];
let currentIndex = -1;

/** 进度同步定时器 */
let progressTimer: NodeJS.Timeout | null = null;

/** 状态变更订阅者（渲染端通过 IPC 订阅） */
const statusSubscribers = new Set<(status: ListenTogetherStatus) => void>();

/**
 * Track → SyncTrack 简化映射
 * @param track - 完整曲目对象
 * @returns 同步用最小化曲目
 */
const toSyncTrack = (track: Track | null): SyncTrack | null => {
  if (!track) return null;
  // streaming 源在跨端同步中视为 local（客户端无法直接获取主机流媒体）
  const source: SyncTrack["source"] =
    track.source === "netease" || track.source === "qqmusic" || track.source === "kugou"
      ? track.source
      : "local";
  return {
    id: String(track.id ?? ""),
    source,
    title: track.title ?? "",
    artist: track.artists?.map((a) => a.name).join(", ") ?? "",
    album: track.album?.name ?? "",
    duration: track.duration ?? 0,
  };
};

/** 当前生效配置 */
const getConfig = (): ListenTogetherSettings =>
  store.get("listenTogether") as ListenTogetherSettings;

/** 构造当前状态快照 */
const buildStatus = (): ListenTogetherStatus => ({
  role,
  hostAddress,
  hostPort,
  hasPassword: hostPassword !== null && hostPassword.length > 0,
  members: Array.from(hostMembers.values()),
  clientUrl,
  hostName: clientHostName,
  latency: clientLatency,
  lastError: clientLastError,
});

/** 通知所有订阅者状态变化 */
const notifyStatus = (): void => {
  const snapshot = buildStatus();
  for (const fn of statusSubscribers) {
    try {
      fn(snapshot);
    } catch (err) {
      ltLog.error("状态订阅回调异常:", err);
    }
  }
};

/** 订阅状态变化（IPC 层调用） */
export const subscribeStatus = (fn: (status: ListenTogetherStatus) => void): (() => void) => {
  statusSubscribers.add(fn);
  // 立即投递一次当前状态
  fn(buildStatus());
  return () => statusSubscribers.delete(fn);
};

/** 获取当前状态（IPC 层调用） */
export const getStatus = (): ListenTogetherStatus => buildStatus();

/** 获取当前角色 */
export const getRole = (): "idle" | "host" | "client" => role;

/** 获取当前主机信息（客户端模式被主机拒绝时用于诊断） */
export const getClientLastError = (): string | null => clientLastError;

// ─── 主机模式 ───────────────────────────────────────────────────────

/**
 * 进入主机模式
 * @param name - 主机显示名
 * @param level - 主机级别
 * @param password - 会话口令
 * @param port - 监听端口
 */
export const enterHostMode = (
  name: string,
  level: UserLevel,
  password: string,
  port: number,
): void => {
  hostInfo = { name, level };
  hostPassword = password;
  hostPort = port;
  hostAddress = null;
  hostMembers.clear();
  role = "host";
  startProgressTimer();
  notifyStatus();
};

/**
 * 退出主机模式
 */
export const exitHostMode = (): void => {
  hostInfo = null;
  hostPassword = null;
  hostPort = null;
  hostAddress = null;
  hostMembers.clear();
  if (role === "host") role = "idle";
  stopProgressTimer();
  notifyStatus();
};

/**
 * 主机模式：设置监听地址（绑定成功后由 server 调用）
 */
export const setHostAddress = (address: string | null): void => {
  hostAddress = address;
  notifyStatus();
};

/** 获取主机级别（server 用于握手校验） */
export const getHostLevel = (): UserLevel => hostInfo?.level ?? "default";
/** 获取主机显示名（server 用于 welcome 回包） */
export const getHostName = (): string => hostInfo?.name ?? "主机";
/** 获取主机口令（server 用于握手校验） */
export const getHostPassword = (): string | null => hostPassword;
/** 获取主机端口 */
export const getHostPort = (): number | null => hostPort;

/**
 * 主机模式：新增成员
 * @returns 新成员对象
 */
export const addMember = (id: string, name: string, level: UserLevel): ListenTogetherMember => {
  const member: ListenTogetherMember = { id, name, level, latency: 0 };
  hostMembers.set(id, member);
  notifyStatus();
  return member;
};

/**
 * 主机模式：移除成员
 */
export const removeMember = (id: string): void => {
  hostMembers.delete(id);
  notifyStatus();
};

/**
 * 主机模式：更新成员延迟
 */
export const updateMemberLatency = (id: string, latency: number): void => {
  const member = hostMembers.get(id);
  if (member) {
    member.latency = latency;
    notifyStatus();
  }
};

/**
 * 主机模式：取所有已连接成员的 WebSocket id 列表
 */
export const getMemberIds = (): string[] => Array.from(hostMembers.keys());

// ─── 客户端模式 ─────────────────────────────────────────────────────

/**
 * 进入客户端模式
 * @param url - 主机 URL
 */
export const enterClientMode = (url: string): void => {
  clientUrl = url;
  clientHostName = null;
  clientLatency = 0;
  clientLastError = null;
  role = "client";
  notifyStatus();
};

/**
 * 退出客户端模式
 * @param error - 可选的退出原因
 */
export const exitClientMode = (error?: string): void => {
  clientUrl = null;
  clientHostName = null;
  clientLatency = 0;
  clientLastError = error ?? null;
  if (role === "client") role = "idle";
  notifyStatus();
};

/** 客户端模式：设置主机名 */
export const setClientHostName = (name: string): void => {
  clientHostName = name;
  notifyStatus();
};

/** 客户端模式：设置单向延迟 */
export const setClientLatency = (latency: number): void => {
  clientLatency = latency;
  notifyStatus();
};

/** 客户端模式：记录最近一次错误 */
export const setClientLastError = (error: string | null): void => {
  clientLastError = error;
  notifyStatus();
};

// ─── 播放器事件钩子（主机端调用） ───────────────────────────────────

/**
 * 主机端：曲目切换
 * @param track - 新曲目
 * @param position - 起始位置
 * @param state - 播放状态
 */
export const onHostTrackChange = (
  track: Track | null,
  position: number,
  state: PlayerState,
): void => {
  currentTrack = track;
  currentPosition = position;
  currentState = state;
  // 主机广播由 server 模块订阅事件完成；这里只维护本地状态
};

/**
 * 主机端：播放状态变化
 */
export const onHostStateChange = (state: PlayerState): void => {
  currentState = state;
};

/**
 * 主机端：拖动进度
 */
export const onHostSeek = (positionMs: number): void => {
  currentPosition = positionMs;
};

/**
 * 主机端：队列更新（同时校正索引边界）
 */
export const onHostQueueUpdate = (queue: Track[], index: number): void => {
  currentQueue = queue;
  currentIndex = queue.length === 0 ? -1 : Math.max(0, Math.min(index, queue.length - 1));
};

// ─── 客户端回放控制（客户端端调用，由 client.ts 触发） ───────────────

/**
 * 客户端：应用远端曲目切换
 * @param syncTrack - 远端同步过来的曲目
 * @param position - 起始位置
 * @param state - 播放状态
 * @returns 解析后的本地曲目（用于引擎加载）
 */
export const applyRemoteTrackChange = (
  syncTrack: SyncTrack | null,
  position: number,
  state: "playing" | "paused",
): { track: Track | null; position: number; shouldPlay: boolean } => {
  if (!syncTrack) {
    currentState = "paused";
    currentPosition = 0;
    return { track: null, position: 0, shouldPlay: false };
  }
  // 重建轻量 Track 供 player:load 使用；URL 解析在 client.ts 完成
  const track: Track = {
    id: syncTrack.id,
    source: syncTrack.source,
    title: syncTrack.title,
    artists: syncTrack.artist ? [{ name: syncTrack.artist }] : [],
    album: syncTrack.album ? { name: syncTrack.album } : undefined,
    duration: syncTrack.duration,
  };
  currentTrack = track;
  currentState = state === "playing" ? "playing" : "paused";
  currentPosition = position;
  return { track, position, shouldPlay: state === "playing" };
};

/**
 * 客户端：应用远端状态变化
 */
export const applyRemoteStateChange = (state: "playing" | "paused"): void => {
  currentState = state === "playing" ? "playing" : "paused";
  try {
    const inst = getPlayer();
    if (state === "playing") inst.play();
    else inst.pause();
  } catch (err) {
    ltLog.warn("应用远端状态失败:", err);
  }
};

/**
 * 客户端：应用远端 seek
 */
export const applyRemoteSeek = (positionMs: number): void => {
  currentPosition = positionMs;
  try {
    getPlayer().seek(positionMs / 1000);
  } catch (err) {
    ltLog.warn("应用远端 seek 失败:", err);
  }
};

/**
 * 客户端：应用远端进度同步（不强制 seek，仅校正漂移）
 */
export const applyRemotePositionSync = (positionMs: number): void => {
  currentPosition = positionMs;
  // 漂移超过 1.5s 才主动 seek，避免频繁打断
  try {
    const inst = getPlayer();
    const local = inst.getPosition() * 1000;
    if (Math.abs(local - positionMs) > 1500) inst.seek(positionMs / 1000);
  } catch {
    // 引擎未就绪时忽略
  }
};

// ─── 进度同步定时器 ─────────────────────────────────────────────────

/**
 * 启动周期进度同步定时器（仅 progressMode=interval 时实际广播）
 */
const startProgressTimer = (): void => {
  stopProgressTimer();
  const config = getConfig();
  if (config.progressMode !== "interval") return;
  const interval = Math.max(500, config.progressInterval);
  progressTimer = setInterval(() => {
    if (role !== "host") return;
    try {
      const pos = getPlayer().getPosition() * 1000;
      currentPosition = pos;
      // 实际广播由 server 模块的 onTick 钩子处理
      onProgressTick?.(pos);
    } catch {
      // 引擎未就绪
    }
  }, interval);
};

/** 周期进度广播钩子（server 注册） */
let onProgressTick: ((positionMs: number) => void) | null = null;

/** server 注册周期广播钩子 */
export const setProgressTickHandler = (fn: ((positionMs: number) => void) | null): void => {
  onProgressTick = fn;
};

/** 停止进度同步定时器 */
const stopProgressTimer = (): void => {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
};

// ─── 查询接口 ───────────────────────────────────────────────────────

/** 取当前曲目（SyncTrack 形式） */
export const getCurrentSyncTrack = (): SyncTrack | null => toSyncTrack(currentTrack);

/** 取当前播放状态 */
export const getCurrentState = (): "playing" | "paused" =>
  currentState === "playing" ? "playing" : "paused";

/** 取当前位置（毫秒） */
export const getCurrentPosition = (): number => currentPosition;

/**
 * 取当前队列快照（按 queueMode 切片）
 */
export const getCurrentQueueSnapshot = () =>
  sliceQueue(
    currentQueue.map((t) => toSyncTrack(t)!).filter(Boolean),
    currentIndex,
    getConfig().queueMode,
  );

/**
 * 设置当前队列索引（主机端切歌时由 player.ts 通知）
 */
export const setCurrentIndex = (index: number): void => {
  currentIndex = index;
};

/**
 * 客户端：接收队列快照后写入本地（仅用于 UI 显示）
 */
export const setClientQueue = (tracks: Track[], index: number): void => {
  currentQueue = tracks;
  currentIndex = index;
};

// 协议版本号 re-export，便于 server / client 引用
export { PROTOCOL_VERSION };
