/**
 * MCP Agent 探测与配置注入
 *
 * 探测本地已安装的 AI Agent（Codex / Claude Code / Cursor / Claude Desktop / CodeBuddy /
 * Antigravity IDE），把 Soto Player 的 MCP 服务地址 + X-MCP-Key 注入到 Agent 配置文件中，
 * 让 Agent 在下次启动时自动接入本播放器的 MCP 服务。
 *
 * 注入格式按 Agent 区分：
 * - Codex：TOML [mcp_servers.soto-player] 段
 * - Claude Code / Cursor / CodeBuddy：JSON mcpServers["soto-player"]
 * - Claude Desktop：JSON mcpServers["soto-player"]（只读探测，不支持自动注入）
 * - Antigravity：JSON mcpServers["soto-player"]（serverUrl + headers 字段名不同）
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { app } from "electron";
import type { McpAgentApp, McpClientConfigParams } from "@shared/types/settings";
import { nativeLog } from "@main/utils/logger";
import { isLinux, isMac, isWin } from "@main/utils/config";

interface AgentDefinition {
  id: string;
  name: string;
  getConfigPath: () => string;
  getInstallPaths: () => string[];
  format?: "json" | "toml" | "antigravity";
  /** injectable=false 表示只探测不自动注入（如 Claude Desktop 需手动编辑） */
  injectable?: boolean;
}

const getAppDataPath = () => app.getPath("appData");

/**
 * 受支持的 Agent 列表
 *
 * 配置路径与安装探测路径均按平台区分；Claude Desktop 在 Windows 上需要从 LocalAppData
 * 取路径，macOS 上则位于 ~/Library/Application Support。
 */
const SUPPORTED_AGENTS: AgentDefinition[] = [
  {
    id: "codex",
    name: "Codex",
    getConfigPath: () => path.join(os.homedir(), ".codex", "config.toml"),
    getInstallPaths: () => [
      path.join(os.homedir(), ".codex"),
      ...(isWin ? [path.join(getAppDataPath(), "..", "Local", "OpenAI", "Codex")] : []),
    ],
    format: "toml",
  },
  {
    id: "claudecode",
    name: "Claude Code",
    getConfigPath: () => path.join(os.homedir(), ".claude.json"),
    getInstallPaths: () => [path.join(os.homedir(), ".claude")],
  },
  {
    id: "cursor",
    name: "Cursor",
    getConfigPath: () => path.join(os.homedir(), ".cursor", "mcp.json"),
    getInstallPaths: () => [
      path.join(os.homedir(), ".cursor"),
      ...(isWin ? [path.join(getAppDataPath(), "..", "Local", "Programs", "cursor")] : []),
    ],
  },
  {
    id: "claudedesktop",
    name: "Claude Desktop",
    getConfigPath: () => {
      if (isWin) {
        return path.join(getAppDataPath(), "Claude", "claude_desktop_config.json");
      }
      return path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      );
    },
    getInstallPaths: () => [
      isWin
        ? path.join(getAppDataPath(), "Claude")
        : path.join(os.homedir(), "Library", "Application Support", "Claude"),
    ],
    injectable: false,
  },
  {
    id: "codebuddy",
    name: "CodeBuddy",
    getConfigPath: () => path.join(os.homedir(), ".codebuddy", "mcp.json"),
    getInstallPaths: () => [path.join(os.homedir(), ".codebuddy")],
  },
  {
    id: "antigravity",
    name: "Antigravity IDE / CLI",
    getConfigPath: () => path.join(os.homedir(), ".gemini", "config", "mcp_config.json"),
    getInstallPaths: () => {
      const userInstallPaths = [
        path.join(os.homedir(), ".gemini", "antigravity"),
        path.join(os.homedir(), ".gemini", "antigravity-ide"),
        path.join(os.homedir(), ".gemini", "antigravity-cli"),
      ];
      if (isWin) {
        return [
          ...userInstallPaths,
          path.join(getAppDataPath(), "Antigravity"),
          path.join(getAppDataPath(), "..", "Local", "Programs", "Antigravity"),
          path.join(getAppDataPath(), "..", "Local", "Antigravity"),
        ];
      }
      if (isMac) {
        return [
          ...userInstallPaths,
          "/Applications/Antigravity.app",
          path.join(os.homedir(), "Applications", "Antigravity.app"),
        ];
      }
      if (isLinux) {
        return [
          ...userInstallPaths,
          path.join(os.homedir(), ".config", "Antigravity"),
          "/opt/Antigravity",
        ];
      }
      return userInstallPaths;
    },
    format: "antigravity",
  },
];

/**
 * 探测本地已安装的 AI Agent 及配置状态
 *
 * 探测两件事：
 * 1. Agent 是否安装（任意 install path 或 config path 存在）
 * 2. 配置文件是否已包含 soto-player 条目
 */
export const detectMcpAgents = async (): Promise<McpAgentApp[]> => {
  const detected: McpAgentApp[] = [];

  for (const agent of SUPPORTED_AGENTS) {
    const configPath = agent.getConfigPath();
    const installed = await Promise.any(
      [configPath, ...agent.getInstallPaths()].map((candidate) => fs.stat(candidate)),
    ).then(
      () => true,
      () => false,
    );

    if (!installed) continue;

    let configured = false;
    try {
      const stats = await fs.stat(configPath);
      if (stats.isFile()) {
        const content = await fs.readFile(configPath, "utf-8");
        configured =
          agent.format === "toml"
            ? /^\s*\[mcp_servers\.soto-player\]\s*$/m.test(content)
            : !!JSON.parse(content || "{}")?.mcpServers?.["soto-player"];
      }
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") {
        nativeLog.warn(`Failed to read config for ${agent.name} at ${configPath}: ${e.message}`);
      }
    }

    detected.push({
      id: agent.id,
      name: agent.name,
      configPath,
      configured,
      injectable: agent.injectable !== false,
    });
  }

  return detected;
};

/**
 * 将 Soto Player 的 MCP 配置注入到目标 Agent 中
 *
 * TOML 格式（Codex）：追加 [mcp_servers.soto-player] 段，含 url + http_headers
 * JSON 格式（默认）：写入 mcpServers["soto-player"] = { type:"http", url, headers }
 * Antigravity 格式：写入 mcpServers["soto-player"] = { serverUrl, headers }
 *
 * @param agentId - Agent 标识（来自 detectMcpAgents 的 id 字段）
 * @param params - MCP 服务端口 + 访问密钥
 */
export const injectMcpAgentConfig = async (
  agentId: string,
  params: McpClientConfigParams,
): Promise<boolean> => {
  const agent = SUPPORTED_AGENTS.find((a) => a.id === agentId);
  if (!agent) {
    throw new Error(`Unsupported agent: ${agentId}`);
  }
  if (agent.injectable === false) {
    throw new Error(`Automatic configuration is not supported for ${agent.name}`);
  }

  const configPath = agent.getConfigPath();

  if (agent.format === "toml") {
    let content = "";
    try {
      content = await fs.readFile(configPath, "utf-8");
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      if (e.code !== "ENOENT") throw error;
    }

    // 已存在 soto-player 段时视为成功（幂等）
    if (/^\s*\[mcp_servers\.soto-player\]\s*$/m.test(content)) return true;

    const section = [
      "[mcp_servers.soto-player]",
      `url = "http://127.0.0.1:${params.port}/mcp"`,
      `http_headers = { "X-MCP-Key" = ${JSON.stringify(params.accessKey)} }`,
    ].join("\n");
    const nextContent = `${content.trimEnd()}${content.trim() ? "\n\n" : ""}${section}\n`;

    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, nextContent, "utf-8");
    return true;
  }

  // JSON 格式：读取已有内容并合并 mcpServers.soto-player
  let json: Record<string, unknown> = {};

  try {
    const content = await fs.readFile(configPath, "utf-8");
    json = JSON.parse(content || "{}") as Record<string, unknown>;
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      json = {};
    } else {
      throw new Error(`Failed to parse agent config: ${e.message}`);
    }
  }

  if (!json.mcpServers || typeof json.mcpServers !== "object") {
    json.mcpServers = {};
  }
  const mcpServers = json.mcpServers as Record<string, unknown>;

  mcpServers["soto-player"] =
    agent.format === "antigravity"
      ? {
          serverUrl: `http://127.0.0.1:${params.port}/mcp`,
          headers: { "X-MCP-Key": params.accessKey },
        }
      : {
          type: "http",
          url: `http://127.0.0.1:${params.port}/mcp`,
          headers: { "X-MCP-Key": params.accessKey },
        };

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(json, null, 2), "utf-8");

  return true;
};

/**
 * 从 Agent 配置中移除 Soto Player 条目
 *
 * @param agentId - Agent 标识
 */
export const removeMcpAgentConfig = async (agentId: string): Promise<boolean> => {
  const agent = SUPPORTED_AGENTS.find((a) => a.id === agentId);
  if (!agent) {
    throw new Error(`Unsupported agent: ${agentId}`);
  }
  if (agent.injectable === false) {
    throw new Error(`Automatic configuration is not supported for ${agent.name}`);
  }

  const configPath = agent.getConfigPath();

  if (agent.format === "toml") {
    let content = "";
    try {
      content = await fs.readFile(configPath, "utf-8");
    } catch (error) {
      const e = error as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return true;
      throw error;
    }
    // 删除 [mcp_servers.soto-player] 段及其后到下一个 [ 段前的所有行
    const cleaned = content.replace(
      /^\s*\[mcp_servers\.soto-player\]\s*\n(.*?)(?=^\s*\[|$)/gms,
      "",
    );
    if (cleaned !== content) {
      await fs.writeFile(configPath, cleaned.trimEnd() + "\n", "utf-8");
    }
    return true;
  }

  try {
    const content = await fs.readFile(configPath, "utf-8");
    const json = JSON.parse(content || "{}") as Record<string, unknown>;
    const mcpServers = json.mcpServers as Record<string, unknown> | undefined;
    if (mcpServers && "soto-player" in mcpServers) {
      delete mcpServers["soto-player"];
      await fs.writeFile(configPath, JSON.stringify(json, null, 2), "utf-8");
    }
    return true;
  } catch (error) {
    const e = error as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return true;
    throw error;
  }
};
