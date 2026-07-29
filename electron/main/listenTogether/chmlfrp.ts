/**
 * ChmlFrp 内网穿透管理（frpc 客户端版）
 *
 * 主机端：用户在 HostDialog 中粘贴 frpc.toml 配置文本，应用写入临时文件后
 * spawn `frpc -c <tmpfile>` 启动 frpc，frpc 将本地 ws server (127.0.0.1:port)
 * 经 ChmlFrp 服务器映射到公网地址，UI 显示公网地址供房客连接。
 *
 * 客户端：无需 frpc，直接 ws://公网地址:端口 连接主机。
 *
 * frpc 二进制随应用打包（electron-builder extraResources 按平台架构筛选），
 * 下载地址：https://panel.chmlfrp.net/tunnel/download
 *
 * 目录结构（按平台-架构分子目录）：
 *   开发环境：<项目根>/native/frpc/{platform}-{arch}/{frpc|frpc.exe}
 *   生产环境：<resourcesPath>/native/frpc/{platform}-{arch}/{frpc|frpc.exe}
 *
 * 一起听功能基于 ChmlFrp（https://chmlfrp.cn）免费 FRP 服务实现。
 *
 * 跨平台支持：
 *   - win32-x64 / win32-arm64:    frpc.exe
 *   - darwin-x64 / darwin-arm64:  frpc
 *   - linux-x64 / linux-arm64 / linux-armv7l: frpc
 *
 * Electron 平台架构映射（process.platform + process.arch → 目录名）：
 *   win32 + x64/arm64        → win32-x64 / win32-arm64
 *   darwin + x64/arm64       → darwin-x64 / darwin-arm64
 *   linux  + x64/arm64        → linux-x64 / linux-arm64
 *   linux  + arm              → linux-armv7l   (Electron armv7l 对应 Node arm)
 *
 * 用户也可在设置中指定自定义 frpc 二进制路径（chmlFrpBinaryPath），
 * 设置后优先使用自定义路径，方便多版本切换或避免重复下载。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";
import { ltLog } from "@main/utils/logger";
import { store } from "@main/store";

/** ChmlFrp 运行时状态 */
export interface ChmlFrpStatus {
  /** frpc 进程是否运行中 */
  running: boolean;
  /** 解析出的公网访问地址（host:port 或 domain），客户端用此地址连接 */
  publicAddress: string | null;
  /** 最近一次错误 */
  error: string | null;
  /** 代理是否已成功启动（frpc 输出 "start proxy success"） */
  proxyReady: boolean;
}

/** 运行中的 frpc 进程 */
let processRef: ChildProcess | null = null;
/** 解析出的公网地址（从 frpc.toml 中提取） */
let currentPublicAddress: string | null = null;
/** 最近一次错误 */
let lastError: string | null = null;
/** 代理是否就绪（frpc stdout 输出 "start proxy success"） */
let currentProxyReady = false;
/** stdout 环形缓冲区（解析跨行日志） */
let stdoutBuffer = "";
/** 临时配置文件路径（stopChmlFrp 时清理） */
let configFilePath: string | null = null;
/** 进程意外退出时的回调（server.ts 注册用于触发 stopHost 兜底清理） */
let exitHandler: ((code: number | null) => void) | null = null;

/** 平台对应的可执行文件名
 *
 * Windows 上为 frpc.exe；Linux/macOS 上为 frpc（无 .exe 后缀）。
 */
const BINARY_NAME = process.platform === "win32" ? "frpc.exe" : "frpc";

/**
 * 当前运行时对应的平台-架构子目录名
 *
 * Electron platform/arch → frpc 目录名映射：
 *   win32  + x64/arm64  → win32-x64 / win32-arm64
 *   darwin + x64/arm64  → darwin-x64 / darwin-arm64
 *   linux  + x64/arm64  → linux-x64 / linux-arm64
 *   linux  + arm        → linux-armv7l   (Electron armv7l 平台的 Node process.arch 值为 "arm")
 */
const PLATFORM_ARCH = (() => {
  const p = process.platform;
  const a = process.arch;
  // Electron armv7l 二进制在 Node 中 process.arch === "arm"
  if (p === "linux" && a === "arm") return "linux-armv7l";
  return `${p}-${a}`;
})();

/**
 * 解析 frpc 二进制路径
 *
 * 查找优先级：
 *   1. 用户在设置中指定的自定义路径（chmlFrpBinaryPath）
 *   2. 生产环境：process.resourcesPath/native/frpc/{platform}-{arch}/<binary>
 *   3. 开发环境：项目根目录 native/frpc/{platform}-{arch}/<binary>
 *
 * 二进制随应用打包（electron-builder extraResources 按当前目标平台筛选）。
 * 找不到时返回 null，上层 UI 给出明确提示。
 */
export const findFrpcBinary = (): string | null => {
  // 1. 用户自定义路径（最高优先级）
  try {
    const customPath = store.get("listenTogether.chmlFrpBinaryPath") as string | undefined;
    if (customPath && typeof customPath === "string" && customPath.trim()) {
      const trimmed = customPath.trim();
      if (existsSync(trimmed)) {
        return trimmed;
      }
      ltLog.warn(`[chmlfrp] 自定义 frpc 路径不存在: ${trimmed}`);
    }
  } catch (err) {
    ltLog.warn("[chmlfrp] 读取自定义 frpc 路径失败:", err);
  }

  // 2. 生产环境：process.resourcesPath/native/frpc/{platform}-{arch}/<binary>
  if (process.env.NODE_ENV === "production" || !process.env.ELECTRON_RENDERER_URL) {
    const resourcesPath = process.resourcesPath ?? "";
    const prodPath = path.join(
      resourcesPath,
      "native",
      "frpc",
      PLATFORM_ARCH,
      BINARY_NAME,
    );
    if (existsSync(prodPath)) return prodPath;
    // electron-builder asarUnpack 的另一种路径（兼容）
    const altPath = path.join(
      resourcesPath,
      "app.asar.unpacked",
      "native",
      "frpc",
      PLATFORM_ARCH,
      BINARY_NAME,
    );
    if (existsSync(altPath)) return altPath;
  }

  // 3. 开发环境：native/frpc/{platform}-{arch}/<binary>
  const devCandidates = [
    path.join(process.cwd(), "native", "frpc", PLATFORM_ARCH, BINARY_NAME),
    path.join(__dirname, "..", "..", "..", "..", "native", "frpc", PLATFORM_ARCH, BINARY_NAME),
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "native",
      "frpc",
      PLATFORM_ARCH,
      BINARY_NAME,
    ),
  ];
  for (const candidate of devCandidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(resolved)) return resolved;
  }

  return null;
};

/**
 * 从 frpc.toml 配置文本中解析出公网访问地址
 *
 * 解析策略（按优先级）：
 * 1. TCP 类型代理 + remotePort：公网地址 = `${serverAddr}:${remotePort}`
 * 2. HTTP/HTTPS 类型 + customDomains：公网地址 = customDomains[0]
 * 3. STCP 类型 + remotePort：公网地址 = `${serverAddr}:${remotePort}`（需访客端配置，少用）
 *
 * @returns 公网地址（host:port 或 domain）；解析失败返回 null
 */
const parsePublicAddress = (toml: string): string | null => {
  // 提取 serverAddr（必填字段，frpc 服务端地址）
  const serverAddrMatch = toml.match(/serverAddr\s*=\s*"([^"]+)"/);
  const serverAddr = serverAddrMatch?.[1];
  if (!serverAddr) {
    ltLog.warn("[chmlfrp] 未在配置中找到 serverAddr");
    return null;
  }

  // 提取第一个 [[proxies]] 段（多代理时仅取第一个用于 ws 暴露）
  // 简化处理：从全文中匹配 type / remotePort / customDomains
  const proxyTypeMatch = toml.match(/type\s*=\s*"([^"]+)"/);
  const proxyType = proxyTypeMatch?.[1] ?? "tcp";

  if (proxyType === "tcp" || proxyType === "stcp" || proxyType === "xtcp") {
    const remotePortMatch = toml.match(/remotePort\s*=\s*(\d+)/);
    const remotePort = remotePortMatch?.[1];
    if (!remotePort) {
      ltLog.warn(`[chmlfrp] ${proxyType} 类型代理缺少 remotePort`);
      return null;
    }
    return `${serverAddr}:${remotePort}`;
  }

  if (proxyType === "http" || proxyType === "https") {
    const customDomainsMatch = toml.match(/customDomains\s*=\s*\[([^\]]+)\]/);
    if (customDomainsMatch) {
      const domainsRaw = customDomainsMatch[1];
      const firstDomain = domainsRaw
        .split(",")
        .map((s) => s.trim().replace(/^"|"$/g, ""))
        .find((s) => s.length > 0);
      if (firstDomain) return firstDomain;
    }
    ltLog.warn(`[chmlfrp] ${proxyType} 类型代理缺少 customDomains`);
    return null;
  }

  // 其他类型（udp/sudp 等）：尝试 remotePort
  const remotePortMatch = toml.match(/remotePort\s*=\s*(\d+)/);
  const remotePort = remotePortMatch?.[1];
  if (remotePort) return `${serverAddr}:${remotePort}`;

  ltLog.warn(`[chmlfrp] 未识别的代理类型或缺少端口: type=${proxyType}`);
  return null;
};

/**
 * 解析 frpc stdout 输出，提取代理就绪状态与错误信息
 *
 * frpc 启动成功时输出（不同版本略有差异）：
 * - "start proxy success"（v0.51+）
 * - "proxy success" / "I[start proxy]"
 * - "start proxy success with tunnel"
 *
 * 失败时输出：
 * - "login to server error" / "login to server failed"（鉴权失败/服务器不可达）
 * - "listen error" / "listen port error"（本地端口被占用）
 * - "proxy already exists"（重名代理）
 * - "port not allowed"（remotePort 被服务端禁止）
 */
const parseOutput = (chunk: string): void => {
  stdoutBuffer += chunk;
  const lines = chunk.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) ltLog.info(`[chmlfrp:out] ${trimmed}`);

    // 代理启动成功
    if (/start proxy success|proxy success|I\[start proxy\]/i.test(trimmed)) {
      if (!currentProxyReady) {
        currentProxyReady = true;
        lastError = null;
        ltLog.info("[chmlfrp] 代理已就绪");
      }
    }

    // 错误识别（取最后一条作为当前错误，便于反映最新状态）
    const lower = trimmed.toLowerCase();
    if (
      lower.includes("error") ||
      lower.includes("failed") ||
      lower.includes("panic") ||
      lower.includes("fatal")
    ) {
      // 跳过非致命警告（日志噪音，不影响代理）
      if (/warn|w\[/i.test(trimmed)) continue;
      lastError = trimmed;
    }
  }
  // 截断时保留末尾 8KB（最新输出）
  if (stdoutBuffer.length > 16_000) {
    stdoutBuffer = stdoutBuffer.slice(-8_000);
  }
};

/**
 * 启动 ChmlFrp（frpc 客户端）
 *
 * @param tomlConfig - frpc.toml 配置文本（用户在 HostDialog 中粘贴）
 * @returns 启动是否成功（仅代表进程是否启动；代理就绪需轮询 getChmlFrpStatus）
 */
export const startChmlFrp = async (tomlConfig: string): Promise<boolean> => {
  // 先同步停止旧实例（包括等待进程退出），避免端口/资源冲突
  await stopChmlFrp();
  stdoutBuffer = "";
  currentPublicAddress = null;
  lastError = null;
  currentProxyReady = false;

  const binary = findFrpcBinary();
  if (!binary) {
    lastError = `未找到当前平台 (${PLATFORM_ARCH}) 的 frpc 二进制文件，请在「设置 → 一起听」中配置自定义 frpc 路径，或前往 https://panel.chmlfrp.net/tunnel/download 下载对应平台版本`;
    ltLog.warn(`[chmlfrp] 未找到 frpc 二进制 (platform-arch=${PLATFORM_ARCH})`);
    return false;
  }

  // 解析公网地址（用于 UI 展示给房客）
  const publicAddress = parsePublicAddress(tomlConfig);
  if (!publicAddress) {
    lastError =
      "frpc.toml 配置解析失败：请确保包含 serverAddr 与 [[proxies]] 段（TCP 类型需 remotePort）";
    ltLog.warn("[chmlfrp] 配置解析失败");
    return false;
  }
  currentPublicAddress = publicAddress;

  // 写入临时配置文件（userData 目录，避免权限问题与 tmp 目录被清理）
  const userDataPath = app.getPath("userData");
  const frpcDir = path.join(userDataPath, "frpc");
  try {
    mkdirSync(frpcDir, { recursive: true });
  } catch (err) {
    lastError = `创建配置目录失败: ${(err as Error).message}`;
    ltLog.error("[chmlfrp] 创建配置目录失败:", err);
    return false;
  }
  const configFile = path.join(frpcDir, "frpc.toml");
  try {
    writeFileSync(configFile, tomlConfig, "utf-8");
  } catch (err) {
    lastError = `写入配置文件失败: ${(err as Error).message}`;
    ltLog.error("[chmlfrp] 写入配置文件失败:", err);
    return false;
  }
  configFilePath = configFile;

  const args = ["-c", configFile];
  ltLog.info(`[chmlfrp] 启动: ${binary} ${args.join(" ")}`);
  ltLog.info(`[chmlfrp] 解析公网地址: ${publicAddress}`);

  try {
    const child = spawn(binary, args, {
      detached: false,
      windowsHide: true,
    });
    processRef = child;
    // unref 让父进程事件循环不再等待 frpc 子进程退出
    child.unref();

    child.stdout?.on("data", (data: Buffer) => parseOutput(data.toString()));
    child.stderr?.on("data", (data: Buffer) => parseOutput(data.toString()));

    child.on("error", (err) => {
      ltLog.error("[chmlfrp] 进程错误:", err);
      lastError = err.message;
      processRef = null;
    });

    child.on("exit", (code) => {
      ltLog.warn(`[chmlfrp] 进程退出: code=${code}`);
      const wasRunning = processRef === child;
      if (wasRunning) {
        processRef = null;
        currentProxyReady = false;
      }
      // 非 0 退出码且无明确错误时给出兜底提示
      if (!lastError && code !== 0 && code !== null) {
        lastError = `frpc 异常退出 (code ${code})`;
      }
      // 通知 server.ts 进程意外退出（用于触发 stopHost 兜底清理）
      if (wasRunning && exitHandler) {
        try {
          exitHandler(code);
        } catch (err) {
          ltLog.warn("[chmlfrp] exitHandler 执行异常:", err);
        }
      }
    });

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ltLog.error("[chmlfrp] 启动失败:", err);
    lastError = msg;
    return false;
  }
};

/**
 * 注册 frpc 进程意外退出回调
 *
 * server.ts 在 startHost 时注册，用于在 frpc 崩溃时主动清理主机模式。
 * 主动 stopChmlFrp 不触发此回调（仅 processRef === child 时才触发）。
 *
 * @param handler - 进程退出回调，参数为退出码（null 表示被信号杀死）
 */
export const onProcessExit = (handler: ((code: number | null) => void) | null): void => {
  exitHandler = handler;
};

/**
 * 停止 frpc 进程
 *
 * 改为 async 以等待进程真正退出，避免重启时旧实例仍占用配置文件。
 * Windows 下用 taskkill /F /T 杀整个进程树（frpc 可能 spawn 子进程）。
 * 跨平台 SIGKILL 兜底（Node.js 在 Windows 上 child.kill("SIGKILL") 调 TerminateProcess）。
 *
 * 异步 taskkill + 2s 超时兜底，避免 spawnSync 阻塞 Node 事件循环导致窗口未响应。
 */
export const stopChmlFrp = async (): Promise<void> => {
  const child = processRef;
  // 清掉 exitHandler 避免主动停止时触发回调
  exitHandler = null;
  if (!child) {
    currentProxyReady = false;
    currentPublicAddress = null;
    lastError = null;
    // 清理临时配置文件
    cleanupConfigFile();
    return;
  }
  currentProxyReady = false;
  try {
    child.removeAllListeners();
    if (!child.killed) {
      if (process.platform === "win32" && typeof child.pid === "number") {
        // 异步 taskkill /T 杀进程树 + 2s 超时兜底
        await new Promise<void>((resolve) => {
          let killDone = false;
          const killFinish = (): void => {
            if (killDone) return;
            killDone = true;
            resolve();
          };
          const killProc = spawn(
            "taskkill",
            ["/F", "/T", "/PID", String(child.pid)],
            {
              windowsHide: true,
              stdio: "ignore",
            },
          );
          killProc.unref();
          killProc.on("exit", (code) => {
            if (code !== 0) {
              ltLog.warn(`[chmlfrp] taskkill 退出码 ${code}，将走 SIGKILL 兜底`);
            }
            killFinish();
          });
          killProc.on("error", (err) => {
            ltLog.warn("[chmlfrp] taskkill 执行失败:", err.message);
            killFinish();
          });
          const killFinishTimer = setTimeout(killFinish, 2000);
          killFinishTimer.unref?.();
        });
      } else {
        child.kill("SIGTERM");
      }
    }
    // 等待最多 2s 让进程退出；超时则强制 SIGKILL 兜底
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        resolve();
      };
      child.once("exit", finish);
      const sigkillTimer = setTimeout(() => {
        if (!done) {
          try {
            child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
        finish();
      }, 2000);
      sigkillTimer.unref?.();
    });
  } catch (err) {
    ltLog.warn("[chmlfrp] 停止进程异常:", err);
  } finally {
    processRef = null;
    currentProxyReady = false;
    currentPublicAddress = null;
    lastError = null;
    cleanupConfigFile();
  }
};

/**
 * 清理临时配置文件
 *
 * stopChmlFrp 后调用，避免下次启动时旧配置残留。
 * 文件不存在时静默忽略。
 */
const cleanupConfigFile = (): void => {
  if (!configFilePath) return;
  try {
    if (existsSync(configFilePath)) {
      unlinkSync(configFilePath);
    }
  } catch (err) {
    ltLog.warn("[chmlfrp] 清理配置文件失败:", err);
  }
  configFilePath = null;
};

/**
 * 等待 frpc 代理就绪（带超时）
 *
 * server.ts 在 startHost 中调用：spawn frpc 后等待 "start proxy success" 信号，
 * 确保公网地址已真正生效后再返回。默认 15s 超时（frpc 通常 2-5s 内即可就绪）。
 *
 * @returns true=已就绪; false=超时未就绪
 */
export const waitForProxyReady = (timeoutMs = 15_000): Promise<boolean> =>
  new Promise((resolve) => {
    if (currentProxyReady) {
      resolve(true);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => {
      if (currentProxyReady) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (!processRef) {
        // 进程已退出，无需继续等待
        clearInterval(timer);
        resolve(false);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 300);
    timer.unref?.();
  });

/**
 * 获取当前 ChmlFrp 状态
 */
export const getChmlFrpStatus = (): ChmlFrpStatus => ({
  running: processRef !== null && !processRef.killed,
  publicAddress: currentPublicAddress,
  error: lastError,
  proxyReady: currentProxyReady,
});

// 兼容性导出：旧版 OS 检测（frpc 跨平台一致，无需特殊处理）
export const _platform = os.platform();
