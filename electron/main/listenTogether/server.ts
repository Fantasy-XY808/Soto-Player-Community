/**
 * 一起听主机模式：WebSocket 服务端
 *
 * - 监听指定端口，接受局域网/公网客户端连接
 * - 握手时校验口令与级别，准入门控见 session.ts + level.ts
 * - 接收客户端 ping 维持延迟统计；向所有客户端广播状态变化
 * - 进度周期广播由 session.ts 触发，本模块仅负责发送
 */

import os from "node:os";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { ltLog } from "@main/utils/logger";
import type { ListenTogetherPermissions } from "@shared/types/settings";
import { encode, decode, PROTOCOL_VERSION, type Message, type UserLevel } from "./protocol";
import {
  addMember,
  enterHostMode,
  exitHostMode,
  getHostLevel,
  getHostName,
  getHostPassword,
  getHostPort,
  getHostPermissions,
  getMemberIds,
  getMembersSnapshot,
  removeMember,
  setHostAddress,
  setHostPermissions,
  setProgressTickHandler,
  updateMemberLatency,
  getCurrentSyncTrack,
  getCurrentState,
  getCurrentPosition,
  getCurrentQueueSnapshot,
} from "./session";
import { isLevelSufficient } from "./level";
import {
  startEasyTier,
  stopEasyTier,
  waitForVirtualIp,
  getEasyTierStatus,
  generateShareCode,
  isValidShareCode,
} from "./easytier";
import { store } from "@main/store";

/** 默认房客权限（getHostPermissions 返回 null 时兜底，避免 welcome 中 permissions 为 undefined） */
const DEFAULT_PERMISSIONS: ListenTogetherPermissions = {
  allowClientPause: true,
  allowClientSkip: true,
  allowClientEditQueue: true,
};

/**
 * 虚拟网卡 / 容器网卡关键字黑名单
 *
 * getLanAddress 此前会把 Docker (172.17.x)、VMware (192.168.x)、VirtualBox (192.168.x)
 * 等虚拟网卡的 IP 当作局域网地址返回，导致客户端连不上。
 * 命中黑名单的候选地址会被剔除。
 *
 * 补充：TAP/TUN（OpenVPN）、WireGuard (wg*)、ZeroTier (zt*)、Tailscale 等也是虚拟网卡，
 * 169.254.x.x 是链路本地地址（APIPA，DHCP 失败时分配），均不可作为主机对外地址。
 */
const VIRTUAL_NIC_PATTERNS = [
  "docker",
  "veth",
  "br-",
  "vmnet",
  "vboxnet",
  "virtualbox",
  "hyper-v",
  "vEthernet",
  // OpenVPN / TAP / TUN
  "tap",
  "tun",
  "openvpn",
  // WireGuard
  "wg",
  "wireguard",
  // ZeroTier
  "zt",
  // Tailscale
  "tailscale",
  // EasyTier 自身（--no-tun 模式不会创建网卡，但防御性过滤）
  "easytier",
];

/** 已连接并通过握手的客户端：id ↔ WebSocket */
const clients = new Map<string, WebSocket>();

/** 运行中的 WebSocketServer 实例 */
let wss: WebSocketServer | null = null;

/** startHost 并发互斥锁：避免两次快速调用互杀 EasyTier
 *  （此前第二次调用进入 stopHost 时，第一次的 startEasyTier/waitForVirtualIp 还在进行中，
 *   两者会交叉调用 stopEasyTier 导致第一个实例被杀掉） */
let isStarting = false;

/** 主机代次：每次 startHost 自增，stopHost / 异常回调据此判断是否已被取代 */
let hostGeneration = 0;

/** membersSync 节流时间戳：5s 内多次延迟变化合并为一次广播 */
let lastMembersSyncAt = 0;
/** membersSync 节流定时器：合并窗口结束时的最终广播 */
let pendingMembersSyncTimer: NodeJS.Timeout | null = null;
const MEMBERS_SYNC_THROTTLE_MS = 5000;

/**
 * 取局域网展示地址（优先 192.168 / 10.x 网段，过滤虚拟网卡与链路本地地址）
 * @returns 主机本机 IP
 *
 * 修复：此前用 Object.values(os.networkInterfaces()) 丢失了接口名 key，
 * 导致 VIRTUAL_NIC_PATTERNS 黑名单永不匹配（item.name 在 NetworkInterfaceInfo
 * 类型上不存在，永远是 undefined → 空串）。改用 Object.entries 保留接口名。
 */
const getLanAddress = (): string => {
  const candidates: string[] = [];
  for (const [ifaceName, list] of Object.entries(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family !== "IPv4" || item.internal) continue;
      // 跳过虚拟网卡（Docker/VMware/VirtualBox/WireGuard/ZeroTier 等），避免返回无法路由的 IP
      const name = ifaceName.toLowerCase();
      if (VIRTUAL_NIC_PATTERNS.some((p) => name.includes(p.toLowerCase()))) continue;
      // 跳过链路本地地址 169.254.x.x（APIPA，DHCP 失败时分配，不可路由）
      if (item.address.startsWith("169.254.")) continue;
      candidates.push(item.address);
    }
  }
  return (
    candidates.find((address) => address.startsWith("192.168.")) ??
    candidates.find((address) => address.startsWith("10.")) ??
    candidates[0] ??
    "127.0.0.1"
  );
};

/** 向指定客户端发送消息 */
const send = (ws: WebSocket, msg: Message): void => {
  if (ws.readyState === ws.OPEN) ws.send(encode(msg));
};

/** 向所有已握手客户端广播 */
const broadcast = (msg: Message): void => {
  const frame = encode(msg);
  for (const ws of clients.values()) {
    if (ws.readyState === ws.OPEN) ws.send(frame);
  }
};

/**
 * 处理客户端握手
 * @returns 分配的客户端 id（拒绝时返回 null）
 */
const handleHello = (ws: WebSocket, msg: Extract<Message, { type: "hello" }>): string | null => {
  if (msg.protocol !== PROTOCOL_VERSION) {
    send(ws, { type: "reject", reason: "protocol_mismatch" });
    ws.close(4001, "protocol_mismatch");
    return null;
  }
  const expectedPassword = getHostPassword();
  // hostPassword === null：从未调用 enterHostMode（防御性：拒绝）
  // hostPassword === ""：用户主动留空（=无口令，接受任何口令）
  // 其他值：要求精确匹配
  // 此前 `!expectedPassword` 把空串当作"未设置"，导致空口令客户端被拒绝
  if (
    expectedPassword !== null &&
    expectedPassword !== "" &&
    msg.password !== expectedPassword
  ) {
    send(ws, { type: "reject", reason: "wrong_password" });
    ws.close(4003, "wrong_password");
    return null;
  }
  // level 字段运行时白名单归一：旧版本客户端可能发 "svip" 等已废弃枚举值，
  // 类型层 UserLevel 已统一为 "default"|"vip"，但 JSON.parse 不校验枚举。
  // 归一为本地变量后用于 addMember / isLevelSufficient，避免脏数据进入 hostMembers
  // 进而广播给其他客户端 UI 时出现无对应图标的非法值。
  const level: UserLevel = msg.level === "vip" ? "vip" : "default";
  if (!isLevelSufficient(level, getHostLevel())) {
    send(ws, { type: "reject", reason: "level_insufficient" });
    ws.close(4003, "level_insufficient");
    return null;
  }
  const id = randomUUID();
  clients.set(id, ws);
  addMember(id, msg.name, level);
  // 回送 welcome：含当前曲目/状态/位置/队列/权限，省一次往返
  // permissions 用 ?? DEFAULT_PERMISSIONS 兜底，避免极端时序下为 null 导致 welcome 异常
  const permissions = getHostPermissions() ?? DEFAULT_PERMISSIONS;
  send(ws, {
    type: "welcome",
    hostName: getHostName(),
    hostLevel: getHostLevel(),
    currentTrack: getCurrentSyncTrack(),
    currentPosition: getCurrentPosition(),
    currentState: getCurrentState(),
    queue: getCurrentQueueSnapshot(),
    permissions,
    serverTime: Date.now(),
  });
  // 新成员加入后向所有客户端同步成员列表
  broadcastMembersSync();
  ltLog.info(`客户端加入: ${msg.name} (${msg.level}) -> ${id}`);
  return id;
};

/**
 * 启动主机模式
 * @param name - 主机显示名
 * @param level - 主机级别
 * @param password - 会话口令
 * @param port - 监听端口
 * @param permissions - 房客权限（welcome 中下发给客户端）
 * @returns 监听地址（含端口）；失败返回 null
 */
export const startHost = async (
  name: string,
  level: UserLevel,
  password: string,
  port: number,
  permissions: ListenTogetherPermissions,
): Promise<string | null> => {
  // 并发互斥：两次快速调用时第二次直接返回失败，避免互杀 EasyTier
  if (isStarting) {
    ltLog.warn("startHost 已在进行中，拒绝并发调用");
    return null;
  }
  isStarting = true;
  try {
    // 已在运行：先关闭旧实例
    if (wss) await stopHost();

    const config = store.get("listenTogether") as {
      easyTierEnabled?: boolean;
      easyTierNetworkName?: string;
      easyTierNetworkSecret?: string;
    };

    // EasyTier 失败视为非致命警告：局域网直连场景仍可用，不阻塞主机启动
    // 此前二进制缺失/启动失败直接 return null，导致整个一起听功能不可用
    if (config.easyTierEnabled) {
      const networkName = config.easyTierNetworkName || "soto-player";
      const configuredSecret = config.easyTierNetworkSecret ?? "";
      const networkSecret = isValidShareCode(configuredSecret)
        ? configuredSecret
        : generateShareCode();
      if (configuredSecret !== networkSecret) {
        try {
          store.set("listenTogether.easyTierNetworkSecret", networkSecret);
        } catch {
          // ignore
        }
      }
      // 主机端：--no-tun -i 10.144.144.1，无需 hostLanIp 与 -n 子网代理
      // （EasyTier 内置 TcpProxy 在 --no-tun 模式下会让虚拟 IP 可被其他节点访问）
      const started = await startEasyTier(networkName, networkSecret, "host");
      if (!started) {
        const status = getEasyTierStatus();
        // 回滚分享码：EasyTier 启动失败后分享码已持久化但虚拟网络未建立，
        // 主机若展示给用户，用户复制失效邀请给房客，房客用旧码加入虚拟网络会失败
        try {
          store.set("listenTogether.easyTierNetworkSecret", "");
        } catch {
          // ignore
        }
        ltLog.warn(`[easytier] 启动失败（继续以局域网模式启动主机）: ${status.error}`);
      } else {
        const virtualIp = await waitForVirtualIp();
        if (!virtualIp) {
          await stopEasyTier();
          // 回滚分享码：虚拟 IP 未分配说明虚拟网络未真正建立
          try {
            store.set("listenTogether.easyTierNetworkSecret", "");
          } catch {
            // ignore
          }
          ltLog.warn("[easytier] 15s 内未分配到虚拟 IP（继续以局域网模式启动主机）");
        } else {
          ltLog.info(
            `[easytier] 主机虚拟 IP: ${virtualIp}（--no-tun 模式，TcpProxy 接收入站）分享码: ${networkSecret}`,
          );
        }
      }
    }

    // 取主机 LAN IP 用于 UI 展示（hostAddress）与局域网直连场景的客户端连接
    const hostLanIp = getLanAddress();

    // 自增代次，用于回调判断当前 startHost 是否已被取代
    const myGeneration = ++hostGeneration;

    return new Promise<string | null>((resolve) => {
      // enterHostMode 推迟到 listening 回调中执行：
      // 此前在 new WebSocketServer 之前调用，若构造函数同步抛错（端口范围非法 /
      // net 模块异常），Promise executor 同步抛出，但 enterHostMode 已设置 role="host"，
      // exitHostMode 不会被调用，session 模块的 role 永远卡在 "host"，后续 startHost
      // 调用会被 getRole() !== "host" 的检查误判。改到 listening 后才 enter，
      // 保证 wss 真正就绪后才进入 host 模式。
      setHostPermissions(permissions);
      let server: WebSocketServer | null = null;
      try {
        server = new WebSocketServer({ port, host: "0.0.0.0" });
      } catch (err) {
        // 同步构造异常（理论 rare，但防御性处理）
        ltLog.error(`主机模式 WebSocketServer 构造失败: ${(err as Error).message}`);
        void stopEasyTier().catch(() => {});
        resolve(null);
        return;
      }
      const serverRef = server;
      let settled = false;

      // server.on("error") 改为持续监听：listening 之后的运行时错误也需要日志
      // 此前用 once("error")，settled 后再次报错会被吞掉
      server.on("error", (err: NodeJS.ErrnoException) => {
        if (!settled) {
          settled = true;
          ltLog.error(`主机模式监听 ${port} 失败: ${err.message}`);
          void stopEasyTier().catch(() => {});
          // 若已 enterHostMode 则退出；未 enter 则 exitHostMode 也是空操作
          if (getHostPort() !== null) exitHostMode();
          try {
            serverRef.close();
          } catch {
            // ignore
          }
          resolve(null);
          return;
        }
        // 已 settled 后的运行时错误：仅日志，不再 resolve
        ltLog.warn(`主机模式运行时错误: ${err.message}`);
      });

      server.on("connection", (ws) => {
        let clientId: string | null = null;
        ws.on("message", (data) => {
          const messages = decode(data.toString());
          for (const msg of messages) {
            // 未握手前只接受 hello
            if (!clientId) {
              if (msg.type === "hello") {
                clientId = handleHello(ws, msg);
                // handleHello 返回 null 表示握手被拒：直接 return 跳过后续消息处理
                if (!clientId) return;
              } else {
                ws.close(4002, "unexpected_message");
                return;
              }
              continue;
            }
            handleClientMessage(clientId, ws, msg);
          }
        });
        ws.on("close", () => {
          if (clientId) {
            clients.delete(clientId);
            removeMember(clientId);
            // 成员离开后向剩余客户端同步成员列表
            broadcastMembersSync();
            ltLog.info(`客户端断开: ${clientId}`);
          }
        });
        ws.on("error", (err) => {
          ltLog.warn(`客户端连接异常: ${err.message}`);
        });
      });

      server.once("listening", () => {
        // 已被后续 startHost 取代：放弃当前实例
        if (myGeneration !== hostGeneration) {
          try {
            serverRef.close();
          } catch {
            // ignore
          }
          resolve(null);
          return;
        }
        if (settled) return;
        settled = true;
        // listening 成功后才真正进入主机模式（role="host"、hostPort 等）
        enterHostMode(name, level, password, port);
        wss = serverRef;
        // 复用前面已取的 hostLanIp 作为对客户端展示的连接地址
        setHostAddress(hostLanIp);
        // 注册周期进度广播
        setProgressTickHandler((positionMs) => {
          broadcast({ type: "positionSync", position: positionMs, serverTime: Date.now() });
        });
        ltLog.info(`主机模式已启动: ${hostLanIp}:${port}`);
        resolve(hostLanIp);
      });
    });
  } finally {
    isStarting = false;
  }
};

/**
 * 广播成员列表同步（带 5s 节流，合并多次延迟变化）
 *
 * 此前每次 pongBack 心跳（10s 一次）都立即广播，N 个客户端时
 * 每分钟产生 N² 条 membersSync，对带宽和客户端 UI 都不友好。
 */
const broadcastMembersSync = (): void => {
  if (getMemberIds().length === 0) return;
  const now = Date.now();
  // 距上次广播不足 5s：合并到下个窗口
  if (now - lastMembersSyncAt < MEMBERS_SYNC_THROTTLE_MS) {
    if (!pendingMembersSyncTimer) {
      pendingMembersSyncTimer = setTimeout(() => {
        pendingMembersSyncTimer = null;
        lastMembersSyncAt = Date.now();
        if (getMemberIds().length > 0) {
          broadcast({ type: "membersSync", members: getMembersSnapshot() });
        }
      }, MEMBERS_SYNC_THROTTLE_MS);
    }
    return;
  }
  lastMembersSyncAt = now;
  broadcast({ type: "membersSync", members: getMembersSnapshot() });
};

/**
 * 停止主机模式
 *
 * 改为：先发送 bye → 等待 flush（用 send 回调）→ 关闭 ws → 关闭 server
 * 此前 bye 未 flush 就 clients.clear()，导致客户端收不到 bye 直接变孤儿
 */
export const stopHost = async (): Promise<void> => {
  setProgressTickHandler(null);
  // 清理节流定时器，避免停止后再触发广播
  if (pendingMembersSyncTimer) {
    clearTimeout(pendingMembersSyncTimer);
    pendingMembersSyncTimer = null;
  }
  // 自增代次，让进行中的 startHost 回调感知到被取代
  hostGeneration += 1;

  // 通知所有客户端礼貌关闭，并等待 bye flush
  const flushPromises: Promise<void>[] = [];
  for (const ws of clients.values()) {
    if (ws.readyState === ws.OPEN) {
      flushPromises.push(
        new Promise<void>((resolve) => {
          try {
            ws.send(encode({ type: "bye", graceful: true }), (err) => {
              if (err) ltLog.warn("发送 bye 失败:", err.message);
              resolve();
            });
          } catch (err) {
            ltLog.warn("发送 bye 异常:", err);
            resolve();
          }
        }),
      );
      // 给客户端 200ms 处理 bye 后再关闭
      try {
        ws.close(1000, "host_stopping");
      } catch {
        // ignore
      }
    }
  }
  await Promise.all(flushPromises);
  // 强制 terminate 任何未关闭的连接（兜底）
  for (const ws of clients.values()) {
    try {
      if (ws.readyState !== ws.CLOSED) ws.terminate();
    } catch {
      // ignore
    }
  }
  clients.clear();

  // 停止 EasyTier（已改 async）
  await stopEasyTier();

  const server = wss;
  wss = null;
  if (!server) {
    exitHostMode();
    return;
  }
  await new Promise<void>((resolve) => {
    server.close((err) => {
      if (err) ltLog.warn("主机关闭异常:", err);
      exitHostMode();
      resolve();
    });
  });
};

/**
 * 处理已握手客户端的消息
 */
const handleClientMessage = (clientId: string, _ws: WebSocket, msg: Message): void => {
  switch (msg.type) {
    case "ping": {
      // 原样回 pong（带客户端原始 t），客户端据此算 RTT
      const client = clients.get(clientId);
      if (client && client.readyState === client.OPEN) {
        client.send(encode({ type: "pong", t: msg.t }));
      }
      break;
    }
    case "pongBack":
      // 客户端回传测量好的单向延迟（RTT/2），避免本端用 Date.now() - msg.t 估算
      updateMemberLatency(clientId, Math.max(0, Math.round(msg.latency)));
      // 延迟变化后同步给所有客户端（节流到 5s 一次，由 broadcastMembersSync 合并）
      broadcastMembersSync();
      break;
    case "pong":
    case "bye":
      // 客户端 -> 主机方向的 pong/bye 通常无意义，忽略
      break;
    // hello / welcome / reject / trackChange / stateChange / seek / queueUpdate / positionSync
    // 客户端不应主动发这些；忽略
    default:
      break;
  }
};

// ─── 主机端广播入口（由 player.ts 通过 IPC 调用） ────────────────────

/**
 * 广播曲目切换
 */
export const broadcastTrackChange = (): void => {
  if (getMemberIds().length === 0) return;
  broadcast({
    type: "trackChange",
    track: getCurrentSyncTrack(),
    position: getCurrentPosition(),
    state: getCurrentState(),
    serverTime: Date.now(),
  });
};

/**
 * 广播播放状态变化
 */
export const broadcastStateChange = (state: "playing" | "paused"): void => {
  if (getMemberIds().length === 0) return;
  broadcast({ type: "stateChange", state, serverTime: Date.now() });
};

/**
 * 广播拖动进度
 */
export const broadcastSeek = (positionMs: number): void => {
  if (getMemberIds().length === 0) return;
  broadcast({ type: "seek", position: positionMs, serverTime: Date.now() });
};

/**
 * 广播队列更新
 */
export const broadcastQueueUpdate = (): void => {
  if (getMemberIds().length === 0) return;
  broadcast({ type: "queueUpdate", queue: getCurrentQueueSnapshot() });
};

/** 取当前主机端口（外部查询用） */
export const getRunningHostPort = (): number | null => getHostPort();