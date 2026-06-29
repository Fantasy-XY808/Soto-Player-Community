/**
 * 一起听客户端模式：WebSocket 客户端
 *
 * - 连接主机 URL（ws:// 或 wss://），发送 hello 握手
 * - 收到 welcome 后开始接收同步消息；收到 reject 则退出并提示
 * - 周期 ping 维持连接与延迟测量
 * - 收到 trackChange 时通过网易云接口解析本地账号可播放的 URL 并加载
 * - 断线自动重连（指数退避，最长 30s）
 */

import { WebSocket } from "ws";
import { callNetease } from "@main/apis/netease";
import { getPlayer } from "@main/services/engine";
import { store } from "@main/store";
import { ltLog } from "@main/utils/logger";
import { encode, decode, PROTOCOL_VERSION, type Message, type SyncTrack } from "./protocol";
import {
  enterClientMode,
  exitClientMode,
  setClientHostName,
  setClientLatency,
  setClientLastError,
  applyRemoteTrackChange,
  applyRemoteStateChange,
  applyRemoteSeek,
  applyRemotePositionSync,
  setClientQueue,
} from "./session";
import { getLocalUserInfo, type LocalUserInfo } from "./level";

/** 运行中的 WebSocket */
let ws: WebSocket | null = null;
/** 重连定时器 */
let reconnectTimer: NodeJS.Timeout | null = null;
/** 心跳定时器 */
let pingTimer: NodeJS.Timeout | null = null;
/** 当前目标 URL（用于重连） */
let targetUrl: string | null = null;
/** 当前口令 */
let currentPassword: string | null = null;
/** 本地账号信息 */
let localInfo: LocalUserInfo | null = null;
/** 是否主动断开（不需要重连） */
let intentionalClose = false;
/** 重连退避计数 */
let backoff = 0;
/** RTT 样本（取最近 3 次中位数） */
const rttSamples: number[] = [];

/** 心跳间隔（毫秒） */
const PING_INTERVAL = 10_000;
/** 最大重连间隔（毫秒） */
const MAX_BACKOFF = 30_000;

/**
 * 取网易云歌曲可播放 URL（用本机账号）
 * @param songId - 网易云歌曲 id
 * @returns URL 或 null
 */
const resolveNeteaseUrl = async (songId: string): Promise<string | null> => {
  try {
    const res = await callNetease("song_url", { id: songId, br: 320_000 });
    const body = res.body as {
      code?: number;
      data?: Array<{ id?: number; url?: string | null }>;
    };
    if (body.code !== 200) return null;
    const first = body.data?.[0];
    return first?.url ?? null;
  } catch (err) {
    ltLog.warn("解析网易云 URL 失败:", err);
    return null;
  }
};

/**
 * 加载远端曲目到本地播放器
 * @param syncTrack - 远端曲目
 * @param positionMs - 起始位置
 * @param shouldPlay - 是否自动播放
 */
const loadRemoteTrack = async (
  syncTrack: SyncTrack,
  positionMs: number,
  shouldPlay: boolean,
): Promise<void> => {
  const { track } = applyRemoteTrackChange(
    syncTrack,
    positionMs,
    shouldPlay ? "playing" : "paused",
  );
  if (!track) return;
  let source: string | null = null;
  if (syncTrack.source === "netease") {
    source = await resolveNeteaseUrl(syncTrack.id);
    if (!source) {
      setClientLastError(`无法解析曲目: ${syncTrack.title}`);
      ltLog.warn(`曲目 URL 解析失败: ${syncTrack.id} ${syncTrack.title}`);
      return;
    }
  } else if (syncTrack.source === "local") {
    // 本地音源客户端无法直接获取，标记为不可播放
    setClientLastError(`本地曲目无法同步: ${syncTrack.title}`);
    return;
  } else {
    setClientLastError(`暂不支持的音源: ${syncTrack.source}`);
    return;
  }
  try {
    const inst = getPlayer();
    const meta = await inst.load(source, shouldPlay);
    // 加载完成后校正位置（远端起始位置可能与 0 不同）
    if (positionMs > 1000) {
      inst.seek(positionMs / 1000);
    }
    ltLog.info(`已加载远端曲目: ${syncTrack.title} (duration=${meta.duration}s)`);
  } catch (err) {
    ltLog.error("加载远端曲目失败:", err);
    setClientLastError(`加载失败: ${syncTrack.title}`);
  }
};

/**
 * 处理接收到的消息
 */
const handleMessage = async (msg: Message): Promise<void> => {
  switch (msg.type) {
    case "welcome":
      setClientHostName(msg.hostName);
      // 收到 welcome 后立即发起首次 ping 校准延迟
      sendPing();
      // 同步当前曲目
      if (msg.currentTrack) {
        await loadRemoteTrack(
          msg.currentTrack,
          msg.currentPosition,
          msg.currentState === "playing",
        );
      }
      // 同步队列
      if (msg.queue) {
        setClientQueue(
          msg.queue.tracks.map((t) => ({
            id: t.id,
            source: t.source,
            title: t.title,
            artists: t.artist ? [{ name: t.artist }] : [],
            album: t.album ? { name: t.album } : undefined,
            duration: t.duration,
          })),
          msg.queue.currentIndex,
        );
      }
      break;
    case "reject": {
      const reasonMap: Record<string, string> = {
        wrong_password: "口令错误",
        level_insufficient: "账号级别不足",
        protocol_mismatch: "协议版本不匹配",
        need_login: "需要登录网易云",
      };
      const reason = reasonMap[msg.reason] ?? "被拒绝";
      setClientLastError(reason);
      ltLog.warn(`主机拒绝: ${msg.reason}`);
      intentionalClose = true;
      cleanup();
      exitClientMode(reason);
      break;
    }
    case "trackChange":
      if (msg.track) {
        await loadRemoteTrack(msg.track, msg.position, msg.state === "playing");
      } else {
        try {
          getPlayer().stop();
        } catch {
          // ignore
        }
      }
      break;
    case "stateChange":
      applyRemoteStateChange(msg.state);
      break;
    case "seek":
      applyRemoteSeek(msg.position);
      break;
    case "positionSync":
      applyRemotePositionSync(msg.position);
      break;
    case "queueUpdate":
      setClientQueue(
        msg.queue.tracks.map((t) => ({
          id: t.id,
          source: t.source,
          title: t.title,
          artists: t.artist ? [{ name: t.artist }] : [],
          album: t.album ? { name: t.album } : undefined,
          duration: t.duration,
        })),
        msg.queue.currentIndex,
      );
      break;
    case "pong": {
      const rtt = Date.now() - msg.t;
      rttSamples.push(rtt);
      if (rttSamples.length > 3) rttSamples.shift();
      const sorted = [...rttSamples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? rtt;
      setClientLatency(Math.round(median / 2));
      break;
    }
    case "bye":
      ltLog.info("主机主动关闭会话");
      intentionalClose = true;
      cleanup();
      exitClientMode("主机关闭了会话");
      break;
    case "ping":
      // 主机 -> 客户端 ping（保留双向心跳能力），原样回 pong
      if (ws && ws.readyState === ws.OPEN) ws.send(encode({ type: "pong", t: msg.t }));
      break;
    default:
      break;
  }
};

/** 发送心跳 */
const sendPing = (): void => {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(encode({ type: "ping", t: Date.now() }));
};

/** 清理定时器与连接 */
const cleanup = (): void => {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.removeAllListeners();
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
    } catch {
      // ignore
    }
    ws = null;
  }
};

/**
 * 建立连接（含 hello 握手）
 */
const connect = (): void => {
  if (!targetUrl || !currentPassword) return;
  const password = currentPassword;
  intentionalClose = false;
  ltLog.info(`正在连接主机: ${targetUrl}`);
  const socket = new WebSocket(targetUrl);
  ws = socket;

  socket.on("open", () => {
    if (!localInfo) {
      ltLog.error("本地账号信息缺失，无法握手");
      cleanup();
      exitClientMode("本地账号信息缺失");
      return;
    }
    // 发送 hello
    socket.send(
      encode({
        type: "hello",
        protocol: PROTOCOL_VERSION,
        name: localInfo.name,
        password,
        level: localInfo.level,
      }),
    );
    // 启动心跳
    pingTimer = setInterval(sendPing, PING_INTERVAL);
    // 重置退避
    backoff = 0;
  });

  socket.on("message", (data) => {
    const messages = decode(data.toString());
    for (const msg of messages) {
      void handleMessage(msg);
    }
  });

  socket.on("close", (code, reason) => {
    ltLog.info(`连接关闭: code=${code} reason=${reason.toString()}`);
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    ws = null;
    if (!intentionalClose) scheduleReconnect();
  });

  socket.on("error", (err) => {
    ltLog.warn(`连接错误: ${err.message}`);
    // close 事件会跟随触发，重连由 close 处理
  });
};

/**
 * 安排重连（指数退避）
 */
const scheduleReconnect = (): void => {
  if (intentionalClose) return;
  const config = store.get("listenTogether") as { autoReconnect: boolean };
  if (!config.autoReconnect) {
    exitClientMode("连接已断开");
    return;
  }
  const delay = Math.min(1000 * Math.pow(2, backoff), MAX_BACKOFF);
  backoff += 1;
  ltLog.info(`将在 ${delay}ms 后重连 (尝试 #${backoff})`);
  setClientLastError(`连接断开，${Math.round(delay / 1000)}s 后重连…`);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
};

/**
 * 加入会话
 * @param url - 主机 URL（ws:// 或 wss://）
 * @param password - 会话口令
 * @returns 是否成功发起连接（不代表握手通过；握手结果通过状态订阅推送）
 */
export const joinSession = async (url: string, password: string): Promise<boolean> => {
  // 先查本地账号
  localInfo = await getLocalUserInfo();
  if (!localInfo) {
    setClientLastError("请先登录网易云账号");
    return false;
  }
  // 校验 URL
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      setClientLastError("仅支持 ws:// 或 wss:// 协议");
      return false;
    }
  } catch {
    setClientLastError("URL 格式无效");
    return false;
  }
  // 已有连接：先清理
  cleanup();
  targetUrl = url;
  currentPassword = password;
  backoff = 0;
  rttSamples.length = 0;
  enterClientMode(url);
  // 记住 URL（不含口令）方便下次快速重连
  try {
    store.set("listenTogether.lastHostUrl", url);
  } catch {
    // ignore
  }
  connect();
  return true;
};

/**
 * 离开会话
 */
export const leaveSession = (): Promise<void> => {
  intentionalClose = true;
  // 礼貌通知主机
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(encode({ type: "bye", graceful: true }));
  }
  cleanup();
  exitClientMode();
  return Promise.resolve();
};
