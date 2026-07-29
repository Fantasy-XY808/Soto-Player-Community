import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { Client } from "openrgb-sdk";
import type { default as Device, RGBColor } from "openrgb-sdk/dist/device";
import { store } from "@main/store";
import { openrgbLog } from "@main/utils/logger";
import type {
  RgbColor,
  RgbDeviceInfo,
  RgbFrameData,
  RgbSyncStatus,
} from "@shared/types/rgbSync";

/** 状态变化事件名 */
export const OPENRGB_STATUS_CHANGE_EVENT = "statusChange";

/** 断线重连最大尝试次数 */
const MAX_RECONNECT_ATTEMPTS = 5;

/** 指数退避基础间隔（ms） */
const RECONNECT_BASE_DELAY_MS = 1000;

/** 退避上限（ms），避免指数膨胀过大 */
const RECONNECT_MAX_DELAY_MS = 16_000;

/** 单次 connect 超时（ms） */
const CONNECT_TIMEOUT_MS = 3000;

/** 自动 spawn OpenRGB 后等待服务就绪的时间（ms） */
const OPENRGB_SPAWN_WARMUP_MS = 2500;

/**
 * OpenRGB 平台对应的可执行文件相对路径
 *
 * - Windows: OpenRGB.exe（直接执行）
 * - Linux:   OpenRGB（AppImage 单文件，需可执行权限）
 * - macOS:   OpenRGB.app/Contents/MacOS/OpenRGB（.app bundle 内的可执行文件）
 */
const OPENRGB_BINARY_RELATIVE =
  process.platform === "win32"
    ? "OpenRGB.exe"
    : process.platform === "darwin"
      ? path.join("OpenRGB.app", "Contents", "MacOS", "OpenRGB")
      : "OpenRGB";

/**
 * 当前运行时对应的平台-架构子目录名（与 frpc 共用同一映射规则）
 *
 * OpenRGB 官方只发布 x64 二进制，arm64 / armv7l 等架构需用户自行编译，
 * 应用层按目录查找，找不到时返回 null 并提示用户。
 */
const OPENRGB_PLATFORM_ARCH = (() => {
  const p = process.platform;
  const a = process.arch;
  if (p === "linux" && a === "arm") return "linux-armv7l";
  return `${p}-${a}`;
})();

/**
 * 查找 OpenRGB 二进制路径
 *
 * 查找优先级：
 *   1. 生产环境：process.resourcesPath/native/openrgb/{platform}-{arch}/<binary>
 *   2. 开发环境：项目根目录 native/openrgb/{platform}-{arch}/<binary>
 *
 * 找不到时返回 null，连接失败时上层会提示用户手动启动 OpenRGB。
 */
export const findOpenRgbBinary = (): string | null => {
  // 1. 生产环境：process.resourcesPath/native/openrgb/{platform}-{arch}/<binary>
  if (process.env.NODE_ENV === "production" || !process.env.ELECTRON_RENDERER_URL) {
    const resourcesPath = process.resourcesPath ?? "";
    const prodPath = path.join(
      resourcesPath,
      "native",
      "openrgb",
      OPENRGB_PLATFORM_ARCH,
      OPENRGB_BINARY_RELATIVE,
    );
    if (existsSync(prodPath)) return prodPath;
    // electron-builder asarUnpack 的另一种路径（兼容）
    const altPath = path.join(
      resourcesPath,
      "app.asar.unpacked",
      "native",
      "openrgb",
      OPENRGB_PLATFORM_ARCH,
      OPENRGB_BINARY_RELATIVE,
    );
    if (existsSync(altPath)) return altPath;
  }

  // 2. 开发环境：native/openrgb/{platform}-{arch}/<binary>
  const devCandidates = [
    path.join(process.cwd(), "native", "openrgb", OPENRGB_PLATFORM_ARCH, OPENRGB_BINARY_RELATIVE),
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "native",
      "openrgb",
      OPENRGB_PLATFORM_ARCH,
      OPENRGB_BINARY_RELATIVE,
    ),
    path.join(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "native",
      "openrgb",
      OPENRGB_PLATFORM_ARCH,
      OPENRGB_BINARY_RELATIVE,
    ),
  ];
  for (const candidate of devCandidates) {
    const resolved = path.resolve(candidate);
    if (existsSync(resolved)) return resolved;
  }

  return null;
};

/**
 * 确保 Linux AppImage 具有可执行权限
 *
 * 在 Windows 上构建/移动 AppImage 会丢失 +x 权限位，spawn 前补上。
 * Windows / macOS 无需处理（macOS bundle 内的 binary 自带可执行权限）。
 *
 * 失败时静默忽略，由 spawn 抛出实际错误。
 */
const ensureExecutable = (binaryPath: string): void => {
  if (process.platform === "win32") return;
  try {
    chmodSync(binaryPath, 0o755);
  } catch {
    // 权限不足或文件系统不支持 chmod：忽略，spawn 会抛出实际错误
  }
};

/** 运行中的 OpenRGB 服务端进程（仅当由本应用 spawn 时） */
let openRgbProcess: ChildProcess | null = null;
/** OpenRGB 是否由本应用 spawn（区分用户手动启动的实例，退出时只停自己的） */
let openRgbSpawned = false;

/**
 * 自动启动 OpenRGB 服务端
 *
 * 仅在 SDK 连接失败且 host 为本地（localhost/127.0.0.1）时调用：
 * spawn `OpenRGB --server --startminimized`，等待 warmup 让服务端初始化完成。
 *
 * 已 spawn 过时直接返回，避免重复启动。
 * 应用退出时（before-quit）会调用 stopOpenRgbServer 清理。
 *
 * @returns 是否成功启动（找不到二进制或 spawn 抛错时返回 false）
 */
export const startOpenRgbServer = async (): Promise<boolean> => {
  if (openRgbProcess) return true;

  const binary = findOpenRgbBinary();
  if (!binary) {
    openrgbLog.warn(`[openrgb] 未找到当前平台 (${OPENRGB_PLATFORM_ARCH}) 的 OpenRGB 二进制`);
    return false;
  }

  // Linux AppImage 在 Windows 文件系统上构建/移动后可能丢失 +x 权限，spawn 前补上
  ensureExecutable(binary);

  const args = ["--server", "--startminimized"];
  openrgbLog.info(`[openrgb] spawn: ${binary} ${args.join(" ")}`);

  try {
    const child = spawn(binary, args, {
      detached: false,
      windowsHide: true,
    });
    openRgbProcess = child;
    openRgbSpawned = true;
    child.unref();

    child.stdout?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) openrgbLog.info(`[openrgb:out] ${text}`);
    });
    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString().trim();
      if (text) openrgbLog.warn(`[openrgb:err] ${text}`);
    });
    child.on("error", (err) => {
      openrgbLog.error("[openrgb] 进程错误:", err);
      if (openRgbProcess === child) {
        openRgbProcess = null;
        openRgbSpawned = false;
      }
    });
    child.on("exit", (code) => {
      openrgbLog.warn(`[openrgb] 进程退出: code=${code}`);
      if (openRgbProcess === child) {
        openRgbProcess = null;
        openRgbSpawned = false;
      }
    });

    // 等待 OpenRGB 服务端初始化（监听 6742 端口）
    await new Promise((resolve) => setTimeout(resolve, OPENRGB_SPAWN_WARMUP_MS));
    return true;
  } catch (err) {
    openrgbLog.error("[openrgb] spawn 失败:", err);
    openRgbProcess = null;
    openRgbSpawned = false;
    return false;
  }
};

/**
 * 停止 OpenRGB 服务端（仅当由本应用 spawn）
 *
 * 用户手动启动的 OpenRGB 实例不会被停止，避免影响用户其他 RGB 应用。
 * Windows 用 taskkill /F /T 杀进程树，跨平台用 SIGTERM。
 */
export const stopOpenRgbServer = async (): Promise<void> => {
  const child = openRgbProcess;
  if (!child || !openRgbSpawned) return;
  openRgbSpawned = false;
  try {
    child.removeAllListeners();
    if (!child.killed) {
      if (process.platform === "win32" && typeof child.pid === "number") {
        const killProc = spawn(
          "taskkill",
          ["/F", "/T", "/PID", String(child.pid)],
          { windowsHide: true, stdio: "ignore" },
        );
        killProc.unref();
      } else {
        child.kill("SIGTERM");
      }
    }
  } catch (err) {
    openrgbLog.warn("[openrgb] 停止进程异常:", err);
  } finally {
    openRgbProcess = null;
  }
};

/** OpenRGB 服务端进程是否由本应用启动（用于 UI 显示状态） */
export const isOpenRgbSpawned = (): boolean => openRgbSpawned;

/**
 * 将 SDK Device 转换为渲染层可见的设备信息子集
 * @param device - OpenRGB SDK 返回的设备对象
 * @returns 渲染层使用的精简设备信息
 */
const toDeviceInfo = (device: Device): RgbDeviceInfo => ({
  id: device.deviceId,
  type: device.type,
  name: device.name,
  description: device.description,
  ledCount: device.colors.length,
  zones: device.zones.map((zone) => ({ name: zone.name, ledCount: zone.ledsCount })),
  modes: device.modes.map((mode) => ({ id: mode.id, name: mode.name })),
});

/**
 * 应用全局亮度乘数：最终颜色 = 原色 * (brightness / 100)
 * 颜色分量按线性比例缩放并 clamp 到 [0, 255]
 * @param color - 原始颜色
 * @param brightness - 0-100 的亮度百分比
 * @returns 应用亮度后的颜色
 */
const applyBrightness = (color: RgbColor, brightness: number): RGBColor => {
  const factor = Math.max(0, Math.min(1, brightness / 100));
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n * factor)));
  return { red: clamp(color.r), green: clamp(color.g), blue: clamp(color.b) };
};

/**
 * 将 RgbColor (r/g/b) 映射为 SDK RGBColor (red/green/blue) 并应用亮度
 * @param color - 渲染层颜色
 * @param brightness - 0-100 的亮度百分比
 * @returns SDK 颜色
 */
const toSdkColor = (color: RgbColor, brightness: number): RGBColor =>
  applyBrightness(color, brightness);

/**
 * 将连接错误转换为用户可读的提示信息
 * @param err - 连接过程中抛出的错误
 * @returns 用户友好的错误文案
 */
const describeConnectError = (err: unknown): string => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("ECONNREFUSED")) return "请启动 OpenRGB 并开启 SDK 服务";
  if (msg.includes("timeout")) return "连接超时，请确认 OpenRGB SDK 端口与监听地址";
  if (msg.includes("ENOTFOUND")) return "无法解析主机名，请检查 host 配置";
  if (msg.includes("EHOSTUNREACH")) return "主机不可达，请检查网络连接";
  return msg;
};

/**
 * OpenRGB 连接服务（单例）
 *
 * 负责：
 * - 与 OpenRGB SDK 服务建立 TCP 连接
 * - 缓存设备列表，断线时清空
 * - 接收渲染端推送的颜色帧，应用亮度后下发到各设备
 * - 断线时按指数退避自动重连（1s/2s/4s/8s/16s）
 * - 通过 EventEmitter 通知上层（IPC 桥）状态变化
 */
class OpenRgbService extends EventEmitter {
  /** SDK 客户端实例（连接成功后赋值） */
  private client: Client | null = null;

  /** 当前连接参数 */
  private currentHost = "";
  private currentPort = 6742;

  /** 设备列表缓存 */
  private devices: RgbDeviceInfo[] = [];

  /** 当前错误信息（连接失败 / 断线时设置） */
  private error: string | undefined;

  /** 是否处于手动断开状态（避免 disconnect 后触发自动重连） */
  private manualClosed = false;

  /** 已对哪些设备调用过 setCustomMode（首次下发颜色前必须先调） */
  private customModeSet = new Set<number>();

  /** 重连尝试计数 */
  private reconnectAttempts = 0;

  /** 重连定时器句柄 */
  private reconnectTimer: NodeJS.Timeout | null = null;

  /** 是否已注册 before-quit 钩子 */
  private quitHookRegistered = false;

  constructor() {
    super();
    this.registerQuitHook();
  }

  /** 注册进程退出前的 disconnect 钩子（仅注册一次） */
  private registerQuitHook(): void {
    if (this.quitHookRegistered) return;
    this.quitHookRegistered = true;
    app.on("before-quit", () => {
      try {
        this.disconnect();
      } catch (err) {
        openrgbLog.warn("退出前断开 OpenRGB 失败:", err);
      }
      // 同步停止由本应用 spawn 的 OpenRGB 服务端
      void stopOpenRgbServer().catch((err) => {
        openrgbLog.warn("退出前停止 OpenRGB 服务端失败:", err);
      });
    });
  }

  /** 读取实时亮度配置 */
  private getBrightness(): number {
    try {
      return store.get("rgbSync.brightness");
    } catch {
      return 100;
    }
  }

  /** 触发状态变化事件并广播给订阅者 */
  private emitStatusChange(): void {
    this.emit(OPENRGB_STATUS_CHANGE_EVENT, this.getStatus());
  }

  /** 重置自定义模式标记（连接/重连后设备已脱离 custom 状态，需重新设置） */
  private resetCustomModeFlags(): void {
    this.customModeSet.clear();
  }

  /**
   * 启动断线重连流程（指数退避）
   * - 仅在非手动断开时尝试
   * - 最多重试 5 次，间隔 1s/2s/4s/8s/16s
   * - 重连成功后重置计数
   */
  private scheduleReconnect = (): void => {
    if (this.manualClosed) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.error = "重连失败：已达最大尝试次数";
      openrgbLog.warn(this.error);
      this.emitStatusChange();
      return;
    }
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempts += 1;
    openrgbLog.info(`将在 ${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, delay);
    this.reconnectTimer?.unref?.();
  };

  /** 内部重连：复用上次的 host/port 静默重试，失败则继续退避 */
  private reconnect = async (): Promise<void> => {
    if (this.manualClosed) return;
    if (!this.currentHost || !this.currentPort) return;
    try {
      await this.establishConnection(this.currentHost, this.currentPort, true);
      this.reconnectAttempts = 0;
      openrgbLog.info("重连成功");
    } catch (err) {
      openrgbLog.warn(`重连失败: ${describeConnectError(err)}`);
      this.scheduleReconnect();
    }
  };

  /**
   * 建立底层连接（共用逻辑）
   * @param host - OpenRGB 服务主机
   * @param port - OpenRGB 服务端口
   * @param isReconnect - 是否为重连流程（控制日志级别）
   */
  private async establishConnection(
    host: string,
    port: number,
    isReconnect = false,
  ): Promise<void> {
    const client = new Client("Soto Player", port, host);
    client.on("disconnect", () => {
      // I3 修复：仅当当前 client 就是触发事件的 client 时才处理
      // 避免 connect() 参数变更时旧连接的 disconnect 事件污染新连接状态
      if (this.client !== client) return;
      openrgbLog.warn("OpenRGB 连接已断开");
      this.client = null;
      this.devices = [];
      this.resetCustomModeFlags();
      this.error = "连接已断开，尝试重连中...";
      this.emitStatusChange();
      if (!this.manualClosed) this.scheduleReconnect();
    });
    client.on("error", (err: unknown) => {
      if (this.client !== client) return;
      openrgbLog.warn("OpenRGB socket 错误:", err);
    });
    await client.connect(CONNECT_TIMEOUT_MS);
    this.client = client;
    this.currentHost = host;
    this.currentPort = port;
    this.error = undefined;
    this.manualClosed = false;
    this.resetCustomModeFlags();
    // 拉取设备列表
    const all = await client.getAllControllerData();
    this.devices = all.map(toDeviceInfo);
    openrgbLog.info(
      `已连接 OpenRGB (${host}:${port})，发现 ${this.devices.length} 个设备${isReconnect ? "（重连）" : ""}`,
    );
    this.emitStatusChange();
  }

  /**
   * 连接 OpenRGB 服务
   *
   * 流程：
   *   1. 直接尝试 SDK 连接
   *   2. 若失败且为本地（localhost/127.0.0.1）+ ECONNREFUSED：
   *      自动 spawn 内置 OpenRGB 服务端，warmup 后重试一次
   *   3. 仍失败则按原错误信息回传
   *
   * @param host - 服务主机
   * @param port - 服务端口
   * @returns 连接后的状态快照
   */
  connect = async (host: string, port: number): Promise<RgbSyncStatus> => {
    // 已连接且参数一致：直接返回当前状态
    if (this.client && this.currentHost === host && this.currentPort === port) {
      return this.getStatus();
    }
    // 参数变化或已有连接：先清理旧连接（标记 manualClosed 避免触发重连）
    if (this.client) {
      this.manualClosed = true;
      this.cleanupClient();
    }
    this.manualClosed = false;
    // 取消正在排队的重连
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    try {
      await this.establishConnection(host, port);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1";
      // ECONNREFUSED + 本地连接：自动 spawn 内置 OpenRGB 服务端后重试
      if (errMsg.includes("ECONNREFUSED") && isLocal && !openRgbSpawned) {
        openrgbLog.info("[openrgb] 连接被拒，尝试自动启动内置 OpenRGB 服务端...");
        const spawned = await startOpenRgbServer();
        if (spawned) {
          try {
            await this.establishConnection(host, port);
            return this.getStatus();
          } catch (retryErr) {
            // spawn 后仍失败，落到下面的错误回传
            const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
            openrgbLog.warn(`[openrgb] spawn 后重试连接失败: ${describeConnectError(retryErr)}`);
            this.client = null;
            this.devices = [];
            this.error = `已自动启动 OpenRGB 服务端，但连接仍失败：${describeConnectError({ message: retryMsg } as Error)}`;
            this.emitStatusChange();
            return this.getStatus();
          }
        }
      }
      this.client = null;
      this.devices = [];
      this.error = describeConnectError(err);
      openrgbLog.warn(`连接 OpenRGB 失败: ${this.error}`);
      this.emitStatusChange();
    }
    return this.getStatus();
  };

  /** 断开连接（手动） */
  disconnect = (): void => {
    this.manualClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.cleanupClient();
    this.devices = [];
    this.error = undefined;
    this.resetCustomModeFlags();
    openrgbLog.info("已断开 OpenRGB 连接");
    this.emitStatusChange();
  };

  /** 内部清理：关闭 socket、清空 resolver，不广播状态 */
  private cleanupClient(): void {
    if (this.client) {
      try {
        this.client.disconnect();
      } catch {
        // socket 可能已关闭，忽略
      }
      this.client = null;
    }
  }

  /** 获取当前状态快照 */
  getStatus = (): RgbSyncStatus => ({
    connected: Boolean(this.client),
    devices: this.devices,
    error: this.error,
  });

  /** 重新拉取设备列表 */
  refreshDevices = async (): Promise<RgbDeviceInfo[]> => {
    if (!this.client) {
      this.error = "未连接 OpenRGB";
      return this.devices;
    }
    try {
      const all = await this.client.getAllControllerData();
      this.devices = all.map(toDeviceInfo);
      this.resetCustomModeFlags();
      this.error = undefined;
      openrgbLog.info(`刷新设备列表：${this.devices.length} 个设备`);
      this.emitStatusChange();
    } catch (err) {
      this.error = describeConnectError(err);
      openrgbLog.warn(`刷新设备列表失败: ${this.error}`);
      this.emitStatusChange();
    }
    return this.devices;
  };

  /**
   * 批量下发一帧颜色到多个设备
 *
   * 遍历 frames，对每个设备：
   *   1. 首次下发前调用 setCustomMode
   *   2. 应用全局亮度乘数
   *   3. 调用 updateLeds（fire-and-forget）
   * @param frames - 一帧颜色数据列表
   */
  setColors = (frames: RgbFrameData[]): void => {
    if (!this.client) return;
    const brightness = this.getBrightness();
    for (const frame of frames) {
      if (!frame || !Array.isArray(frame.colors)) continue;
      try {
        if (!this.customModeSet.has(frame.deviceId)) {
          this.client.setCustomMode(frame.deviceId);
          this.customModeSet.add(frame.deviceId);
        }
        const sdkColors = frame.colors.map((c) => toSdkColor(c, brightness));
        this.client.updateLeds(frame.deviceId, sdkColors);
      } catch (err) {
        openrgbLog.warn(`下发颜色到设备 ${frame.deviceId} 失败:`, err);
      }
    }
  };

  /**
   * 测试单个设备：设置为指定颜色（应用当前亮度）
   * @param deviceId - 设备 ID
   * @param color - 测试颜色
   */
  testColor = async (deviceId: number, color: RgbColor): Promise<void> => {
    if (!this.client) {
      throw new Error("未连接 OpenRGB");
    }
    try {
      if (!this.customModeSet.has(deviceId)) {
        this.client.setCustomMode(deviceId);
        this.customModeSet.add(deviceId);
      }
      const brightness = this.getBrightness();
      const sdkColor = toSdkColor(color, brightness);
      // 测试时把设备全部 LED 填充同一颜色，便于直观判断连接是否正常
      const device = this.devices.find((d) => d.id === deviceId);
      const ledCount = device?.ledCount ?? 1;
      const colors: RGBColor[] = Array.from({ length: ledCount }, () => sdkColor);
      this.client.updateLeds(deviceId, colors);
    } catch (err) {
      openrgbLog.warn(`测试设备 ${deviceId} 颜色失败:`, err);
      throw err;
    }
  };
}

/** OpenRGB 服务单例 */
export const openRgbService = new OpenRgbService();
