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
import { SocksProxyAgent } from "socks-proxy-agent";
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
  setClientMembers,
  setClientPermissions,
  applyRemoteTrackChange,
  applyRemoteStateChange,
  applyRemoteSeek,
  applyRemotePositionSync,
  setClientQueue,
} from "./session";
import { getLocalUserInfo, type LocalUserInfo } from "./level";
import {
  startEasyTier,
  stopEasyTier,
  waitForVirtualIp,
  waitForSocks5Ready,
  isValidShareCode,
  onProcessExit,
  HOST_VIRTUAL_IP_ADDR,
  SOCKS5_PORT,
} from "./easytier";

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
/** 累计重连尝试次数（超过 MAX_RECONNECT_ATTEMPTS 后放弃，避免无限重连已失效的 127.0.0.1） */
let reconnectAttempts = 0;
/** WebSocket 握手超时定时器 */
let handshakeTimer: NodeJS.Timeout | null = null;
/** SOCKS5 代理 agent（分享码模式下经此代理连主机虚拟 IP） */
let socksAgent: SocksProxyAgent | null = null;
/** RTT 样本（取最近 3 次中位数） */
const rttSamples: number[] = [];

/** 心跳间隔（毫秒） */
const PING_INTERVAL = 10_000;
/** 最大重连间隔（毫秒） */
const MAX_BACKOFF = 30_000;
/** 最大重连尝试次数（超过则放弃，避免 EasyTier 失效后无限重连 127.0.0.1） */
const MAX_RECONNECT_ATTEMPTS = 10;
/** WebSocket 连接超时（毫秒）——避免不可达地址等待 OS TCP 超时（21s+） */
const WS_HANDSHAKE_TIMEOUT = 8_000;

/**
 * 取网易云歌曲可播放 URL（用本机账号）
 *
 * 此前固定请求 320k，无降级——部分歌曲无 320k 鉴权时返回 null，
 * 客户端直接判定为"无法解析"。改为多档位尝试：320k → 128k → 兜底取首个可用。
 * @param songId - 网易云歌曲 id
 * @returns URL 或 null
 */
const resolveNeteaseUrl = async (songId: string): Promise<string | null> => {
  const bitrates = [320_000, 192_000, 128_000];
  for (const br of bitrates) {
    try {
      const res = await callNetease("song_url", { id: songId, br });
      const body = res.body as {
        code?: number;
        data?: Array<{ id?: number; url?: string | null }>;
      };
      if (body.code !== 200) continue;
      const first = body.data?.[0];
      const url = first?.url ?? null;
      if (url) return url;
    } catch (err) {
      ltLog.warn(`解析网易云 URL 失败 (br=${br}):`, err);
    }
  }
  return null;
};

/**
 * 加载远端曲目到本地播放器
 *
 * 顺序约束：必须先解析 URL 成功，再 applyRemoteTrackChange 写入会话状态。
 * 此前先 apply 再解析，URL 解析失败时会话状态已切到新曲目但播放器仍播旧曲目，
 * 导致 UI 显示新曲名但音频还是旧曲（音画不同步）。
 * @param syncTrack - 远端曲目
 * @param positionMs - 起始位置
 * @param shouldPlay - 是否自动播放
 */
const loadRemoteTrack = async (
  syncTrack: SyncTrack,
  positionMs: number,
  shouldPlay: boolean,
): Promise<void> => {
  // 先解析 URL，失败则保持原状态不变（避免音画不同步）
  let source: string | null = null;
  if (syncTrack.source === "netease") {
    source = await resolveNeteaseUrl(syncTrack.id);
    if (!source) {
      setClientLastError(`无法解析曲目: ${syncTrack.title}`);
      ltLog.warn(`曲目 URL 解析失败: ${syncTrack.id} ${syncTrack.title}`);
      return;
    }
  } else if (syncTrack.source === "qqmusic" || syncTrack.source === "kugou") {
    // QQ/酷狗音源客户端无法直接获取主机账号的鉴权 URL，标记不可播放
    //（流媒体鉴权 URL 跟主机账号绑定，跨端不可用；本地未实现对应 API）
    setClientLastError(`暂不支持的音源: ${syncTrack.source} (${syncTrack.title})`);
    ltLog.warn(`暂不支持的音源: ${syncTrack.source} ${syncTrack.id} ${syncTrack.title}`);
    return;
  } else if (syncTrack.source === "local") {
    // 本地音源客户端无法直接获取主机文件路径，标记为不可播放
    setClientLastError(`本地曲目无法同步: ${syncTrack.title}`);
    return;
  } else {
    setClientLastError(`暂不支持的音源: ${syncTrack.source}`);
    return;
  }
  // URL 就绪后再写入会话状态，保证状态与播放器一致
  const { track } = applyRemoteTrackChange(
    syncTrack,
    positionMs,
    shouldPlay ? "playing" : "paused",
  );
  if (!track) return;
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
      // 主机下发的房客权限（用于 UI 禁用对应操作）
      setClientPermissions(msg.permissions);
      // welcome 表示握手成功，清空此前可能存在的连接期错误（如重连期 lastError）
      // 此前未清空，UI 在加入成功后仍显示"连接断开 Xs 后重连…"残留提示
      setClientLastError(null);
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
      // 拒绝后必须停 EasyTier：此前未调用导致 EasyTier 进程残留，占用虚拟网络席位
      await stopEasyTier();
      exitClientMode(reason);
      break;
    }
    case "trackChange":
      if (msg.track) {
        await loadRemoteTrack(msg.track, msg.position, msg.state === "playing");
      } else {
        // 主机切到空曲目：先同步会话状态再停播放器，避免状态/播放器不一致
        // 此前未调用 applyRemoteTrackChange(null)，导致 UI 仍显示旧曲目
        applyRemoteTrackChange(null, 0, "paused");
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
    case "membersSync":
      // 主机同步过来的成员列表（含自己），用于客户端模式 UI 展示
      setClientMembers(msg.members);
      break;
    case "pong": {
      const rtt = Date.now() - msg.t;
      rttSamples.push(rtt);
      if (rttSamples.length > 3) rttSamples.shift();
      // 中位数算法：length=1 → 取唯一值；length=2 → 取较小值避免高估；
      // length=3 → 取中间值。此前 Math.floor(len/2) 在 length=2 时返回 sorted[1]（较大值）
      // 导致 RTT 估高、latency 估高、UI 长期显示非真实延迟
      const sorted = [...rttSamples].sort((a, b) => a - b);
      const median =
        sorted.length === 1
          ? sorted[0]
          : sorted.length === 2
            ? sorted[0]
            : sorted[Math.floor(sorted.length / 2)];
      const latency = Math.max(0, Math.round(median / 2));
      setClientLatency(latency);
      // 回传给主机，主机端不再用 Date.now() - msg.t 估算（避免时钟不同步导致 0ms）
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(encode({ type: "pongBack", latency }));
      }
      break;
    }
    case "bye":
      ltLog.info("主机主动关闭会话");
      intentionalClose = true;
      cleanup();
      // 主机关闭会话后停止 EasyTier，避免虚拟网络残留
      await stopEasyTier();
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
 *
 * 加入握手超时（WS_HANDSHAKE_TIMEOUT）：避免不可达地址（如端口转发失效）
 * 等待 OS TCP 超时（Linux ~75s，Windows ~21s）造成 UI 长时间停在"连接中"。
 */
const connect = (): void => {
  // currentPassword === null 表示从未设置（joinSession 未调用）；
  // 空串 "" 表示用户主动留空（=无口令加入），是合法值，不能与 null 混淆
  // 此前 `!currentPassword` 把空串当作"未设置"，导致无口令加入时永久卡死
  if (!targetUrl || currentPassword === null) return;
  const password = currentPassword;
  intentionalClose = false;
  ltLog.info(`正在连接主机: ${targetUrl} (尝试 #${reconnectAttempts + 1})`);
  // socksAgent 存在时（分享码模式）经 SOCKS5 代理连主机虚拟 IP 10.144.144.1:port；
  // 否则（局域网直连）直接连。--no-tun 模式下无法主动访问对端虚拟 IP，必须走 SOCKS5。
  const socket = socksAgent ? new WebSocket(targetUrl, { agent: socksAgent }) : new WebSocket(targetUrl);
  ws = socket;

  // 握手超时：8s 内未 open 则主动关闭，触发 close → scheduleReconnect
  if (handshakeTimer) clearTimeout(handshakeTimer);
  handshakeTimer = setTimeout(() => {
    // 用 socket（局部变量）而非 ws（模块变量），避免 ws 在 close 回调里被置 null
    if (socket.readyState !== WebSocket.OPEN) {
      ltLog.warn(`握手超时（${WS_HANDSHAKE_TIMEOUT}ms），关闭重连`);
      try {
        socket.terminate();
      } catch {
        // ignore
      }
    }
  }, WS_HANDSHAKE_TIMEOUT);

  socket.on("open", () => {
    if (handshakeTimer) {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
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
    if (handshakeTimer) {
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }
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
 * 安排重连（指数退避，上限 30s，最多重连 MAX_RECONNECT_ATTEMPTS 次）
 *
 * backoff 计数同样做上限约束：log2(MAX_BACKOFF/1000) + 1 = 5 之后 delay 不再增长，
 * 避免计数无意义累加（虽不影响 delay，但日志中的"#N"会无限增大）。
 *
 * 累计重连次数：超过 MAX_RECONNECT_ATTEMPTS（10 次）后放弃，避免 EasyTier 进程
 * 崩溃后无限重连已失效的 127.0.0.1 端口转发。退出客户端模式并停 EasyTier。
 */
const scheduleReconnect = (): void => {
  if (intentionalClose) return;
  const config = store.get("listenTogether") as { autoReconnect: boolean };
  if (!config.autoReconnect) {
    exitClientMode("连接已断开");
    void stopEasyTier().catch(() => {});
    return;
  }
  reconnectAttempts++;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    ltLog.warn(
      `已重连 ${reconnectAttempts - 1} 次仍失败，放弃重连（EasyTier 可能已失效）`,
    );
    setClientLastError("无法建立虚拟网络连接，请检查网络后重试");
    exitClientMode("无法建立虚拟网络连接");
    void stopEasyTier().catch(() => {});
    reconnectAttempts = 0;
    return;
  }
  // 上限 5：2^5 = 32 > 30，再增无意义
  const cappedBackoff = Math.min(backoff, 5);
  const delay = Math.min(1000 * Math.pow(2, cappedBackoff), MAX_BACKOFF);
  backoff = cappedBackoff + 1;
  ltLog.info(`将在 ${delay}ms 后重连 (尝试 #${reconnectAttempts})`);
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
 * @param shareCode - 可选分享码（6 位）。提供时自动启动 EasyTier 加入同一虚拟网络
 * @returns 是否成功发起连接（不代表握手通过；握手结果通过状态订阅推送）
 */
export const joinSession = async (
  url: string,
  password: string,
  shareCode?: string,
): Promise<boolean> => {
  // 先查本地账号
  localInfo = await getLocalUserInfo();
  if (!localInfo) {
    setClientLastError("请先登录网易云账号");
    return false;
  }
  // 校验 URL（含端口校验：无端口时 new URL 不报错但 hostname 无法路由）
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      setClientLastError("仅支持 ws:// 或 wss:// 协议");
      return false;
    }
    if (!parsed.port) {
      setClientLastError("URL 必须包含端口号（如 ws://192.168.1.100:58000）");
      return false;
    }
  } catch {
    setClientLastError("URL 格式无效");
    return false;
  }
  // 校验分享码（提供时）
  const code = shareCode?.trim().toUpperCase() ?? "";
  if (code && !isValidShareCode(code)) {
    setClientLastError("分享码格式不正确（需 6 位大写字母/数字）");
    return false;
  }

  // 已有连接：先清理
  cleanup();
  // 重置重连计数
  reconnectAttempts = 0;
  // 提供分享码时先启动 EasyTier 加入虚拟网络（DHCP 模式 + SOCKS5 代理）
  // 客户端经本地 SOCKS5 代理（127.0.0.1:51880）连接主机虚拟 IP 10.144.144.1:<port>，
  // 不依赖主机 LAN IP 变化，跨网可达（基于官方文档 no-root.html 途径 B）
  let connectUrl = url;
  if (code) {
    const config = store.get("listenTogether") as { easyTierNetworkName?: string };
    const networkName = config.easyTierNetworkName || "soto-player";
    const port = parseInt(parsed.port, 10);
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      setClientLastError("URL 端口无效（需 1-65535）");
      return false;
    }
    // 启动 EasyTier（--no-tun --dhcp --socks5 51880 --no-listener）
    const started = await startEasyTier(networkName, code, "client");
    if (!started) {
      setClientLastError("EasyTier 启动失败，请重试");
      resetClientState();
      return false;
    }
    const virtualIp = await waitForVirtualIp();
    if (!virtualIp) {
      await stopEasyTier();
      setClientLastError("EasyTier 15s 内未分配到虚拟 IP，请检查网络");
      resetClientState();
      return false;
    }
    // 等待 SOCKS5 代理 TCP 端口真正可连（而非仅依赖 stdout 文本信号）
    // 此前未等待，导致首连接因 SOCKS5 未 bind 而失败，触发 8s 握手超时 + 指数退避重连，
    // 用户感知"加入失败"。官方源码 gateway/socks5.rs:480 的 Socks5ServerNet 日志仅表示
    // 任务创建，bind 完成晚 100-500ms，必须用 TCP 探测确认真实就绪。
    const socks5Ready = await waitForSocks5Ready();
    if (!socks5Ready) {
      await stopEasyTier();
      setClientLastError("EasyTier SOCKS5 代理 15s 内未就绪，请检查网络");
      resetClientState();
      return false;
    }
    // EasyTier 启动成功 + 虚拟 IP 已分配 + SOCKS5 已就绪后才注册 exit 回调
    // （此前在 startEasyTier 之前注册，被 stopEasyTier 内部 exitHandler=null 清掉，
    //  EasyTier 崩溃时回调永不触发，客户端 WebSocket 无限重连已失效的代理）
    onProcessExit(() => {
      ltLog.warn("[easytier] 进程意外退出，触发客户端模式退出");
      intentionalClose = true;
      if (handshakeTimer) {
        clearTimeout(handshakeTimer);
        handshakeTimer = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanup();
      exitClientMode("虚拟网络连接已断开");
      resetClientState();
    });
    // 构造 SOCKS5 代理 agent，后续 WebSocket 连接均经此代理
    // EasyTier 监听 0.0.0.0:51880（源码硬编码），SocksProxyAgent 仅连 127.0.0.1 保证本机使用
    socksAgent = new SocksProxyAgent(`socks5://127.0.0.1:${SOCKS5_PORT}`);
    ltLog.info(
      `[easytier] 客户端已加入虚拟网络: ${virtualIp} 分享码: ${code} 经 SOCKS5 代理连 ${HOST_VIRTUAL_IP_ADDR}:${port}`,
    );
    // 连接主机虚拟 IP（保留原 URL 的 path/query）
    connectUrl = `ws://${HOST_VIRTUAL_IP_ADDR}:${port}${parsed.pathname ?? "/"}${parsed.search ?? ""}`;
  }

  targetUrl = connectUrl;
  currentPassword = password;
  backoff = 0;
  rttSamples.length = 0;
  enterClientMode(connectUrl);
  // 记住 URL（不含口令）方便下次快速重连
  try {
    store.set("listenTogether.lastHostUrl", url);
  } catch {
    // ignore
  }
  connect();
  return true;
};

/** 模块级状态归零：用于 joinSession 失败 / leaveSession 后清理
 *
 * 此前 leaveSession 不重置 targetUrl / currentPassword / localInfo / backoff /
 * rttSamples / intentionalClose，导致下次 joinSession 之间残留状态污染，
 * 例如切换主机后仍以旧 url 重连、旧 localInfo 误用、backoff 不归零立刻 30s 退避。
 */
const resetClientState = (): void => {
  targetUrl = null;
  currentPassword = null;
  localInfo = null;
  backoff = 0;
  reconnectAttempts = 0;
  rttSamples.length = 0;
  intentionalClose = false;
  // 清理 SOCKS5 代理 agent（下次 joinSession 若无分享码则不走代理）
  socksAgent = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (handshakeTimer) {
    clearTimeout(handshakeTimer);
    handshakeTimer = null;
  }
  // 注销 EasyTier 进程 exit 回调，避免下次 joinSession 之间被旧回调打扰
  onProcessExit(null);
};

/**
 * 离开会话
 *
 * 改为 async：等待 bye flush + EasyTier 完全退出，避免下次 joinSession 时
 * EasyTier 进程残留 / WebSocket 未真正关闭导致状态错乱。
 */
export const leaveSession = async (): Promise<void> => {
  intentionalClose = true;
  // 礼貌通知主机（带 send 回调等待 flush，避免 bye 未发出就 close）
  if (ws && ws.readyState === ws.OPEN) {
    await new Promise<void>((resolve) => {
      try {
        ws!.send(encode({ type: "bye", graceful: true }), (err) => {
          if (err) ltLog.warn("发送 bye 失败:", err.message);
          resolve();
        });
      } catch (err) {
        ltLog.warn("发送 bye 异常:", err);
        resolve();
      }
    });
  }
  cleanup();
  await stopEasyTier();
  exitClientMode();
  // 模块级状态归零，避免下次 joinSession 残留
  resetClientState();
};
