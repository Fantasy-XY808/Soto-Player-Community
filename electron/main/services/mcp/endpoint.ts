/**
 * MCP HTTP 端点管理
 *
 * 基于 Streamable HTTP 传输，为每个客户端会话维护独立的 McpServer 实例。
 * 会话设有数量与空闲时间上限，避免外部客户端异常退出后长期占用内存。
 */

import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

/** MCP 端点抽象，由上层 HTTP 路由调用 */
export interface McpEndpoint {
  /** 处理单次 HTTP 请求 */
  handle(request: Request): Promise<Response>;
  /** 关闭端点并释放全部会话 */
  close(): Promise<void>;
}

interface McpSession {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
  lastUsedAt: number;
}

/** 最大并发会话数；超过后驱逐最旧 */
const MAX_SESSIONS = 8;
/** 单会话空闲时长上限（30 分钟），超时自动关闭 */
const SESSION_IDLE_MS = 30 * 60 * 1000;

/** 构造 JSON-RPC 错误响应 */
const errorResponse = (status: number, code: number, message: string): Response =>
  Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });

/**
 * 创建有界的 MCP HTTP 端点
 * @param createServer - 为新会话创建 MCP Server 的工厂函数
 */
export const createMcpEndpoint = (createServer: () => McpServer): McpEndpoint => {
  const sessions = new Map<string, McpSession>();

  const closeSession = async (id: string): Promise<void> => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    await session.server.close();
  };

  /** 驱逐空闲超时会话 */
  const evictExpired = async (): Promise<void> => {
    const deadline = Date.now() - SESSION_IDLE_MS;
    const expired = [...sessions.entries()]
      .filter(([, session]) => session.lastUsedAt < deadline)
      .map(([id]) => id);
    await Promise.all(expired.map(closeSession));
  };

  /** 会话数达上限时驱逐最旧 */
  const evictOldest = async (): Promise<void> => {
    if (sessions.size < MAX_SESSIONS) return;
    const oldest = [...sessions.entries()].sort(
      ([, left], [, right]) => left.lastUsedAt - right.lastUsedAt,
    )[0];
    if (oldest) await closeSession(oldest[0]);
  };

  return {
    async handle(request: Request): Promise<Response> {
      await evictExpired();
      const sessionId = request.headers.get("mcp-session-id");
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) return errorResponse(404, -32001, "Session not found");
        session.lastUsedAt = Date.now();
        const response = await session.transport.handleRequest(request);
        // DELETE 请求显式终结会话
        if (request.method === "DELETE") await closeSession(sessionId);
        return response;
      }

      // 新会话必须以 initialize 请求建立
      if (request.method !== "POST") {
        return errorResponse(400, -32000, "Mcp-Session-Id header required");
      }

      const body = await request.clone().json().catch(() => null);
      if (!isInitializeRequest(body)) {
        return errorResponse(400, -32000, "Initialization request required");
      }

      await evictOldest();
      const server = createServer();
      let initializedId: string | null = null;
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        enableJsonResponse: true,
        onsessioninitialized: (id) => {
          initializedId = id;
          sessions.set(id, { server, transport, lastUsedAt: Date.now() });
        },
      });
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body });
      // 初始化未成功时同步关闭 server，避免泄漏
      if (!initializedId) await server.close();
      return response;
    },
    async close(): Promise<void> {
      await Promise.all([...sessions.keys()].map(closeSession));
    },
  };
};
