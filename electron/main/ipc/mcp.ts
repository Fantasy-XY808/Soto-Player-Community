/**
 * MCP 服务相关 IPC
 *
 * - restart：重启服务并返回新状态（端口占用/错误经 McpStatus.error 暴露）
 * - getStatus：查询当前运行状态（面板挂载时拉一次）
 * - getClientConfigParams：获取端口 + accessKey，用于生成 Agent 注入配置
 * - detectAgents：探测本地已安装的 AI Agent
 * - injectAgentConfig：向指定 Agent 配置文件注入 soto-player 条目
 * - removeAgentConfig：从 Agent 配置文件移除 soto-player 条目
 */

import { ipcMain } from "electron";
import {
  getMcpClientConfigParams,
  getMcpStatus,
  restartMcpServer,
  startMcpServer,
  stopMcpServer,
} from "@main/services/mcp";
import {
  detectMcpAgents,
  injectMcpAgentConfig,
  removeMcpAgentConfig,
} from "@main/services/mcp/injector";
import type { McpClientConfigParams } from "@shared/types/settings";

/** 注册 MCP 相关 IPC */
export const registerMcpIpc = (): void => {
  ipcMain.handle("mcp:start", () => startMcpServer());
  ipcMain.handle("mcp:stop", () => stopMcpServer());
  ipcMain.handle("mcp:restart", () => restartMcpServer());
  ipcMain.handle("mcp:getStatus", () => getMcpStatus());
  ipcMain.handle("mcp:getClientConfigParams", () => getMcpClientConfigParams());
  ipcMain.handle("mcp:detectAgents", () => detectMcpAgents());
  ipcMain.handle(
    "mcp:injectAgentConfig",
    (_event, agentId: string, params: McpClientConfigParams) =>
      injectMcpAgentConfig(agentId, params),
  );
  ipcMain.handle("mcp:removeAgentConfig", (_event, agentId: string) =>
    removeMcpAgentConfig(agentId),
  );
};
