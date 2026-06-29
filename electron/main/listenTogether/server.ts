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
import { encode, decode, PROTOCOL_VERSION, type Message, type UserLevel } from "./protocol";
import {
  addMember,
  enterHostMode,
  exitHostMode,
  getHostLevel,
  getHostName,
  getHostPassword,
  getHostPort,
  getMemberIds,
  removeMember,
  setHostAddress,
  setProgressTickHandler,
  updateMemberLatency,
  getCurrentSyncTrack,
  getCurrentState,
  getCurrentPosition,
  getCurrentQueueSnapshot,
} from "./session";
import { isLevelSufficient } from "./level";

/** 已连接并通过握手的客户端：id ↔ WebSocket */
const clients = new Map<string, WebSocket>();

/** 运行中的 WebSocketServer 实例 */
let wss: WebSocketServer | null = null;

/**
 * 取局域网展示地址（优先 192.168 / 10.x 网段）
 * @returns 主机本机 IP
 */
const getLanAddress = (): string => {
  const candidates: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const item of list ?? []) {
      if (item.family === "IPv4" && !item.internal) candidates.push(item.address);
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
  if (!expectedPassword || msg.password !== expectedPassword) {
    send(ws, { type: "reject", reason: "wrong_password" });
    ws.close(4003, "wrong_password");
    return null;
  }
  if (!isLevelSufficient(msg.level as UserLevel, getHostLevel())) {
    send(ws, { type: "reject", reason: "level_insufficient" });
    ws.close(4003, "level_insufficient");
    return null;
  }
  const id = randomUUID();
  clients.set(id, ws);
  addMember(id, msg.name, msg.level as UserLevel);
  // 回送 welcome：含当前曲目/状态/位置/队列，省一次往返
  send(ws, {
    type: "welcome",
    hostName: getHostName(),
    hostLevel: getHostLevel(),
    currentTrack: getCurrentSyncTrack(),
    currentPosition: getCurrentPosition(),
    currentState: getCurrentState(),
    queue: getCurrentQueueSnapshot(),
    serverTime: Date.now(),
  });
  ltLog.info(`客户端加入: ${msg.name} (${msg.level}) -> ${id}`);
  return id;
};

/**
 * 启动主机模式
 * @param name - 主机显示名
 * @param level - 主机级别
 * @param password - 会话口令
 * @param port - 监听端口
 * @returns 监听地址（含端口）；失败返回 null
 */
export const startHost = (
  name: string,
  level: UserLevel,
  password: string,
  port: number,
): Promise<string | null> => {
  // 已在运行：先关闭旧实例
  if (wss) stopHost();
  return new Promise((resolve) => {
    enterHostMode(name, level, password, port);
    const server = new WebSocketServer({ port, host: "0.0.0.0" });
    let settled = false;

    server.on("connection", (ws) => {
      let clientId: string | null = null;
      ws.on("message", (data) => {
        const messages = decode(data.toString());
        for (const msg of messages) {
          // 未握手前只接受 hello
          if (!clientId) {
            if (msg.type === "hello") {
              clientId = handleHello(ws, msg);
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
          ltLog.info(`客户端断开: ${clientId}`);
        }
      });
      ws.on("error", (err) => {
        ltLog.warn(`客户端连接异常: ${err.message}`);
      });
    });

    server.once("listening", () => {
      if (settled) return;
      settled = true;
      wss = server;
      const address = getLanAddress();
      setHostAddress(address);
      // 注册周期进度广播
      setProgressTickHandler((positionMs) => {
        broadcast({ type: "positionSync", position: positionMs, serverTime: Date.now() });
      });
      ltLog.info(`主机模式已启动: ${address}:${port}`);
      resolve(address);
    });

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      ltLog.error(`主机模式监听 ${port} 失败: ${err.message}`);
      exitHostMode();
      try {
        server.close();
      } catch {
        // ignore
      }
      resolve(null);
    });
  });
};

/**
 * 停止主机模式
 */
export const stopHost = (): Promise<void> => {
  setProgressTickHandler(null);
  // 通知所有客户端礼貌关闭
  for (const ws of clients.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(encode({ type: "bye", graceful: true }));
    }
  }
  clients.clear();
  return new Promise((resolve) => {
    if (!wss) {
      exitHostMode();
      resolve();
      return;
    }
    const server = wss;
    wss = null;
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
      // 原样回 pong，客户端据此算 RTT
      const client = clients.get(clientId);
      if (client && client.readyState === client.OPEN) {
        client.send(encode({ type: "pong", t: msg.t }));
      }
      // 更新延迟（RTT/2 估算单向延迟）
      updateMemberLatency(clientId, Math.max(0, Math.round((Date.now() - msg.t) / 2)));
      break;
    }
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
