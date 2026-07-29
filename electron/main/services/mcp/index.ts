/**
 * MCP HTTP 服务器生命周期管理
 *
 * 仅监听本机 127.0.0.1，使用 X-MCP-Key 头部鉴权 + Origin 校验防 DNS rebinding。
 * 服务端口与开关由 settings.aiIntegration.mcpEnabled / mcpPort 控制；
 * accessKey 持久化在 store.aiIntegration.mcpAccessKey，首次启动时随机生成。
 *
 * 启动 / 停止 / 重启 / 状态查询均通过此模块统一暴露。
 */

import type { Server } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { store } from "@main/store";
import { broadcast } from "@main/utils/broadcast";
import { mcpLog } from "@main/utils/logger";
import type { McpClientConfigParams, McpStatus } from "@shared/types/settings";
import { createMcpEndpoint, type McpEndpoint } from "./server";

/** 运行中的 HTTP 服务实例 */
let runningServer: Server | null = null;
/** 运行中的 MCP 端点（持有全部会话） */
let runningEndpoint: McpEndpoint | null = null;
/** 实际监听端口（启动成功后赋值） */
let runningPort: number | null = null;
/** 上次启动失败错误 */
let lastError: { code: string; message: string } | null = null;

/** 查询当前 MCP 服务状态 */
export const getMcpStatus = (): McpStatus => ({
  listening: runningServer !== null,
  port: runningPort,
  error: lastError,
});

/** 向渲染进程同步 MCP 服务状态 */
const publishStatus = (): void => broadcast("mcp:status", getMcpStatus());

/**
 * 获取持久化的本机连接密钥
 *
 * 首次调用时生成 32 字符 hex 随机串并写入 store。
 */
const getAccessKey = (): string => {
  const current = store.get("aiIntegration.mcpAccessKey") as string | undefined;
  if (current) return current;
  const generated = randomBytes(16).toString("hex");
  store.set("aiIntegration.mcpAccessKey", generated);
  return generated;
};

/** 获取生成 AI 客户端配置所需的动态参数（端口 + 密钥） */
export const getMcpClientConfigParams = (): McpClientConfigParams => ({
  port: runningPort ?? store.get("aiIntegration.mcpPort"),
  accessKey: getAccessKey(),
});

/** 使用恒定时间比较连接密钥，防止时序攻击 */
const hasValidAccessKey = (candidate: string | undefined): boolean => {
  if (!candidate) return false;
  const expected = Buffer.from(getAccessKey());
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
};

/**
 * 校验浏览器来源，防止本地 MCP 端点遭受 DNS rebinding 攻击
 *
 * - 无 Origin 头（非浏览器客户端，如 curl / Agent HTTP 调用）放行
 * - Origin 主机必须为 localhost / 127.0.0.1 / [::1]
 */
const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
};

/**
 * 启动仅监听本机的 MCP 服务
 *
 * 已运行或全局开关关闭时直接返回当前状态。
 * 端口占用等错误经 lastError 暴露给 UI。
 */
export const startMcpServer = (): Promise<McpStatus> => {
  return new Promise((resolve) => {
    if (runningServer || !store.get("aiIntegration.mcpEnabled")) {
      resolve(getMcpStatus());
      return;
    }

    const port = store.get("aiIntegration.mcpPort");
    const endpoint = createMcpEndpoint();
    const app = new Hono();
    app.all("/mcp", async (c) => {
      if (!store.get("aiIntegration.mcpEnabled")) return c.json({ error: "MCP disabled" }, 403);
      if (!hasValidAccessKey(c.req.header("x-mcp-key"))) {
        return c.json({ error: "invalid MCP key" }, 401);
      }
      if (!isAllowedOrigin(c.req.header("origin"))) {
        return c.json({ error: "invalid Origin" }, 403);
      }
      return endpoint.handle(c.req.raw);
    });
    app.get("/", (c) => c.text("Soto Player MCP server"));

    let settled = false;
    const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }) as Server;
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      lastError = { code: error.code ?? "UNKNOWN", message: error.message };
      publishStatus();
      mcpLog.error(`MCP 服务监听 ${port} 失败 (${lastError.code}): ${lastError.message}`);
      void endpoint.close();
      try {
        server.close();
      } catch {}
      resolve(getMcpStatus());
    });
    server.once("listening", () => {
      if (settled) return;
      settled = true;
      runningServer = server;
      runningEndpoint = endpoint;
      runningPort = port;
      lastError = null;
      publishStatus();
      mcpLog.info(`MCP 服务已启动: http://127.0.0.1:${port}/mcp`);
      resolve(getMcpStatus());
    });
  });
};

/**
 * 停止 MCP 服务并释放全部会话
 *
 * 先把 runningServer 置空避免重入，再异步等待 server.close 与 endpoint.close 完成。
 */
export const stopMcpServer = async (): Promise<void> => {
  if (!runningServer) return;
  const server = runningServer;
  const endpoint = runningEndpoint;
  runningServer = null;
  runningEndpoint = null;
  runningPort = null;
  publishStatus();
  const serverClosed = new Promise<void>((resolve) => {
    server.close((error) => {
      if (error) mcpLog.warn("MCP 服务关闭异常:", error);
      else mcpLog.info("MCP 服务已关闭");
      resolve();
    });
  });
  await Promise.all([serverClosed, endpoint?.close()]);
};

/** 配置变更后重启 MCP 服务 */
export const restartMcpServer = async (): Promise<McpStatus> => {
  await stopMcpServer();
  return startMcpServer();
};
