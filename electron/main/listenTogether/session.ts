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
  ListenTogetherPermissions,
  ListenTogetherSettings,
  ListenTogetherMember,
  ListenTogetherStatus,
  ListenTogetherCurrentTrack,
} from "@shared/types/settings";
import { store } from "@main/store";
import { getPlayer } from "@main/services/engine";
import { ltLog } from "@main/utils/logger";
import { PROTOCOL_VERSION, sliceQueue, type SyncTrack, type UserLevel } from "./protocol";

/** 当前角色 */
let role: "idle" | "host" | "client" = "idle";

/** 主机模式：本地账号信息 */
let hostInfo: { name: string; level: UserLevel } | null = null;
/** 主机模式：会话口令（null 表示未设置；空串表示已设置为"无口令"——两者需区分） */
let hostPassword: string | null = null;
/** 主机模式：监听端口 */
let hostPort: number | null = null;
/** 主机模式：监听地址 */
let hostAddress: string | null = null;
/** 主机模式：已连接成员（按连接 id 索引） */
const hostMembers = new Map<string, ListenTogetherMember>();
/** 主机模式：主机下发给客户端的房客权限（启动时由 server 写入） */
let hostPermissions: ListenTogetherPermissions | null = null;

/** 客户端模式：连接的主机 URL */
let clientUrl: string | null = null;
/** 客户端模式：主机名称 */
let clientHostName: string | null = null;
/** 客户端模式：单向延迟（毫秒） */
let clientLatency = 0;
/** 客户端模式：最近一次错误（用于 UI 提示） */
let clientLastError: string | null = null;
/** 客户端模式：主机同步过来的成员列表（含自己） */
let clientMembers: ListenTogetherMember[] = [];
/** 客户端模式：主机下发的房客权限（welcome 后写入；未握手前为 null） */
let clientPermissions: ListenTogetherPermissions | null = null;

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

/** SyncTrack / Track → UI 展示用最小化曲目（与 ListenTogetherCurrentTrack 同构） */
const toDisplayTrack = (track: Track | SyncTrack | null): ListenTogetherCurrentTrack | null => {
  if (!track) return null;
  // 区分 Track 与 SyncTrack：SyncTrack 有 source 字段且必为枚举值，Track 有 source 但可能为 streaming
  const source =
    track.source === "netease" ||
    track.source === "qqmusic" ||
    track.source === "kugou" ||
    track.source === "local"
      ? track.source
      : "local";
  // Track 类型上 artists 为数组，SyncTrack 上 artist 为字符串——按字段存在性适配
  // "artists" in track 能正确收窄：SyncTrack 无 artists 字段，命中后 track 为 Track
  const artist =
    "artists" in track
      ? (track.artists?.map((a) => a.name).join(", ") ?? "")
      : (track as SyncTrack).artist ?? "";
  // album 区分：SyncTrack.album 为 string，Track.album 为对象——按 typeof 收窄
  // 此前用 "album" in track 外层判断，但两种类型都有 album 字段无法收窄，
  // 导致 else 分支 track 仍为 Track | SyncTrack，as SyncTrack 转换被 TS 拒绝
  const album =
    typeof track.album === "string"
      ? track.album
      : (track.album?.name ?? "");
  return {
    id: String(track.id ?? ""),
    source,
    title: track.title ?? "",
    artist,
    album,
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
  // hostPassword === null 表示从未设置（未启用口令）；空串表示用户主动留空（=无口令）
  // 两者对外展示都是 hasPassword=false（与协议层 isPasswordSet 区分）
  hasPassword: hostPassword !== null && hostPassword.length > 0,
  members: Array.from(hostMembers.values()),
  clientMembers,
  clientPermissions,
  clientUrl,
  hostName: clientHostName,
  latency: clientLatency,
  lastError: clientLastError,
  currentTrack: toDisplayTrack(currentTrack),
  currentState:
    currentState === "playing" ? "playing" : currentState === "paused" ? "paused" : "idle",
  currentPosition,
  currentQueue: currentQueue.map((t) => toDisplayTrack(t)!).filter(Boolean),
  currentIndex,
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
  hostPermissions = null;
  // 注意：不重置 current* 字段。
  // 跨会话残留已由 exitHostMode / exitClientMode 处理（idle 进入 host 时
  // current* 必为空）。这里保留 idle 期间累积的播放状态——用户在启动主机
  // 前可能已在播放音乐，handlePlayerEvent 在 idle 期间也会写入 current*，
  // 启动主机后客户端加入时 welcome 才能拿到正确的 currentTrack / queue。
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
  hostPermissions = null;
  // 同步重置 current* 字段，UI 回到空闲态展示
  currentTrack = null;
  currentState = "idle";
  currentPosition = 0;
  currentQueue = [];
  currentIndex = -1;
  if (role === "host") role = "idle";
  stopProgressTimer();
  notifyStatus();
};

/**
 * 主机模式：写入房客权限（startHost 时由 server 调用，welcome 中下发）
 */
export const setHostPermissions = (permissions: ListenTogetherPermissions): void => {
  hostPermissions = { ...permissions };
  notifyStatus();
};

/** 主机模式：取房客权限（server 用于构造 welcome） */
export const getHostPermissions = (): ListenTogetherPermissions | null =>
  hostPermissions ? { ...hostPermissions } : null;

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

/**
 * 主机模式：取成员快照（用于构造 membersSync 广播）
 */
export const getMembersSnapshot = (): ListenTogetherMember[] =>
  Array.from(hostMembers.values()).map((m) => ({ ...m }));

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
  clientMembers = [];
  clientPermissions = null;
  // 重置 current* 字段，避免上一次会话残留状态污染本次会话
  currentTrack = null;
  currentState = "idle";
  currentPosition = 0;
  currentQueue = [];
  currentIndex = -1;
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
  clientMembers = [];
  clientPermissions = null;
  // 同步重置 current* 字段
  currentTrack = null;
  currentState = "idle";
  currentPosition = 0;
  currentQueue = [];
  currentIndex = -1;
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

/** 客户端模式：写入主机同步过来的成员列表 */
export const setClientMembers = (members: ListenTogetherMember[]): void => {
  clientMembers = members.map((m) => ({ ...m }));
  notifyStatus();
};

/** 客户端模式：写入主机下发的房客权限（welcome 时一次性写入） */
export const setClientPermissions = (permissions: ListenTogetherPermissions | null): void => {
  clientPermissions = permissions ? { ...permissions } : null;
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
  // 同步更新 currentIndex：新曲目在队列中找到则指向它，找不到则归 -1
  // （此前 idx<0 时保留旧 currentIndex，导致 currentTrack 与 currentIndex 不一致：
  //   主机外部加载一首不在队列中的新曲 D 后，currentTrack=D 但 currentIndex 仍指向旧曲 A，
  //   sliceQueue 按旧索引切片下发给客户端，客户端 UI 显示队列首 A 高亮却正在播 D）
  if (track) {
    const idx = currentQueue.findIndex(
      (t) => String(t.id) === String(track.id) && t.source === track.source,
    );
    currentIndex = idx; // findIndex 未命中返回 -1，正是期望语义
  } else {
    currentIndex = -1;
  }
  // 通知主机本地 UI 刷新（广播由 server 模块负责）
  notifyStatus();
};

/**
 * 主机端：播放状态变化
 */
export const onHostStateChange = (state: PlayerState): void => {
  currentState = state;
  // 通知主机本地 UI 刷新（广播由 server 模块负责）
  notifyStatus();
};

/**
 * 主机端：拖动进度
 */
export const onHostSeek = (positionMs: number): void => {
  currentPosition = positionMs;
  // 主机本地 UI 的进度条高频刷新由 player.ts 的 position 事件负责，
  // 此处不主动 notifyStatus 避免高频通知；广播由 server 模块负责
};

/**
 * 主机端：队列更新（同时校正索引边界）
 */
export const onHostQueueUpdate = (queue: Track[], index: number): void => {
  currentQueue = queue;
  // 队列空或调用方传入 -1（语义为"队列更新但无当前曲"）时归 -1
  // （此前 Math.max(0, -1) = 0，把 -1 强制变 0 指向队列第一首，与 setCurrentIndex 语义不一致）
  currentIndex =
    queue.length === 0 || index < 0 ? -1 : Math.min(index, queue.length - 1);
  // 通知主机本地 UI 刷新队列展示
  notifyStatus();
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
    // 主机切到空曲目：必须同步清空 currentTrack/currentIndex，
    // 此前仅重置 state/position 而 currentTrack 仍保留旧值，
    // 导致客户端 UI 在主机停止后仍显示旧曲目（与主机状态不一致）
    currentTrack = null;
    currentIndex = -1;
    currentState = "paused";
    currentPosition = 0;
    notifyStatus();
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
  notifyStatus();
  return { track, position, shouldPlay: state === "playing" };
};

/**
 * 客户端：应用远端状态变化
 */
export const applyRemoteStateChange = (state: "playing" | "paused"): void => {
  currentState = state === "playing" ? "playing" : "paused";
  // 通知客户端 UI 刷新播放状态（playing ▶ / paused ⏸ 图标切换）
  // 此前漏掉 notifyStatus，导致客户端收到 stateChange 后 UI 状态不更新
  notifyStatus();
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
  // 边界校验：负值或空队列归一为 -1；上限不超过队列长度-1
  // （此前无校验，越界值会污染 sliceQueue 切片）
  // （此前提前 return 跳过 notifyStatus，UI 不刷新；现统一在末尾通知）
  const prevIndex = currentIndex;
  if (currentQueue.length === 0 || index < 0) {
    currentIndex = -1;
  } else {
    currentIndex = Math.min(index, currentQueue.length - 1);
  }
  // 仅在实际变化时通知，避免冗余刷新
  if (prevIndex !== currentIndex) notifyStatus();
};

/**
 * 客户端：接收队列快照后写入本地（仅用于 UI 显示）
 */
export const setClientQueue = (tracks: Track[], index: number): void => {
  currentQueue = tracks;
  // 同样做边界归一，避免客户端拿到越界 index 后 sliceQueue 出错
  if (tracks.length === 0 || index < 0) {
    currentIndex = -1;
  } else {
    currentIndex = Math.min(index, tracks.length - 1);
  }
  // 通知 UI 刷新（此前漏掉 notifyStatus，导致客户端队列 UI 不更新）
  notifyStatus();
};

// 协议版本号 re-export，便于 server / client 引用
export { PROTOCOL_VERSION };
