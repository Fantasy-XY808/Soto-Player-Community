import { execFile } from "node:child_process";
import { powerMonitor } from "electron";
import { systemLog } from "@main/utils/logger";

/**
 * 系统电源状态轮询服务
 *
 * 背景：
 * - Electron 41 的 powerMonitor API 不支持 Windows Battery Saver 检测
 * - 因此在 Windows 平台通过 PowerShell 子进程调用 Win32 GetSystemPowerStatus，
 *   读取 SYSTEM_POWER_STATUS.SystemStatusFlag（0=正常, 1=省电模式启用）
 * - macOS / Linux 回退到 powerMonitor.isOnBatteryPower() 作为低电量信号
 *
 * 设计要点：
 * - 单例：模块内 cache 一个 latest 状态 + listeners 集合
 * - 轮询 10s 一次：PowerShell spawn 单次约 30-50ms CPU，5s 间隔 idle 占用约 1%；
 *   10s 间隔减半到 0.5%，用户切换省电模式到生效感知延迟 10s 完全可接受
 * - 单次查询 5s 超时（远短于轮询间隔，避免连续重叠挂起）
 * - 状态变化才回调监听器；首次拿到状态也会触发一次回调
 */

/** 电源状态快照 */
export interface PowerStateSnapshot {
  /** 是否处于省电模式（Windows Battery Saver / 其他平台低电量） */
  isPowerSave: boolean;
  /** 是否使用电池供电（未接交流电） */
  isOnBattery: boolean;
  /** 电池电量百分比 0~100；未知返回 100（保守值，避免误判低电量） */
  batteryPercent: number;
}

/** 电源状态变化监听器 */
type PowerStateListener = (snapshot: PowerStateSnapshot) => void;

/** 默认轮询间隔（毫秒）
 * 60s = PowerShell spawn 频率降到 1/6，避免频繁超时占用 libuv 线程池
 * Battery Saver 切换是低频操作，60s 检测延迟完全可接受
 * （旧版 10s 在低性能机器或安全软件拦截时频繁超时，日志刷屏且间接影响切歌/IPC 响应）
 */
const DEFAULT_POLL_INTERVAL_MS = 60_000;
/** 单次 PowerShell 调用超时（毫秒），远短于轮询间隔避免重叠挂起 */
const SINGLE_CALL_TIMEOUT_MS = 5000;
/** 失败 backoff 上限（毫秒）：连续超时时间隔指数退避到此上限 */
const MAX_BACKOFF_MS = 300_000; // 5 分钟

/**
 * Windows PowerShell P/Invoke 脚本
 *
 * 通过 Base64 编码后传给 powershell.exe -EncodedCommand，避免转义问题。
 * 输出格式："ACLineStatus,BatteryLifePercent,SystemStatusFlag"
 * - ACLineStatus: 0=离线, 1=在线, 255=未知
 * - BatteryLifePercent: 0-100, 255=未知
 * - SystemStatusFlag: 0=正常, 1=省电模式启用
 */
const POWERSHELL_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PowerStatusHelper {
    [StructLayout(LayoutKind.Sequential)]
    public struct SYSTEM_POWER_STATUS {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte Reserved1;
        public int BatteryLifeTime;
        public int BatteryFullLifeTime;
        public byte SystemStatusFlag;
    }
    [DllImport("kernel32.dll")]
    public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS lpSystemPowerStatus);
}
"@
$ps = New-Object PowerStatusHelper+SYSTEM_POWER_STATUS
[PowerStatusHelper]::GetSystemPowerStatus([ref]$ps) | Out-Null
"$($ps.ACLineStatus),$($ps.BatteryLifePercent),$($ps.SystemStatusFlag)"
`;

/** Base64 编码 PowerShell 脚本（UTF-16LE，PowerShell -EncodedCommand 要求） */
const encodePowerShellScript = (script: string): string => {
  return Buffer.from(script, "utf16le").toString("base64");
};

/** 缓存的 EncodedCommand，避免每次轮询都重新编码 */
const ENCODED_COMMAND = encodePowerShellScript(POWERSHELL_SCRIPT);

/** 当前最新电源状态；null 表示尚未查询过 */
let latestSnapshot: PowerStateSnapshot | null = null;

/** 监听器集合 */
const listeners = new Set<PowerStateListener>();

/** 轮询定时器（用 setTimeout 递归调度，便于失败时动态调整间隔） */
let pollTimer: ReturnType<typeof setTimeout> | null = null;

/** 当前轮询间隔（毫秒） */
let currentIntervalMs = DEFAULT_POLL_INTERVAL_MS;

/** 连续失败次数：用于指数退避，成功时清零 */
let consecutiveFailures = 0;

/** 是否在轮询中（避免重叠调用） */
let polling = false;

/**
 * 单次调用 Windows PowerShell 查询电源状态
 *
 * @returns 解析后的快照；调用失败返回 null
 */
const queryWindowsPowerState = (): Promise<PowerStateSnapshot | null> => {
  return new Promise<PowerStateSnapshot | null>((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      consecutiveFailures++;
      systemLog.warn(
        `[powerState] PowerShell 调用超时 (连续 ${consecutiveFailures} 次)`,
      );
      resolve(null);
    }, SINGLE_CALL_TIMEOUT_MS);
    timeout.unref?.();

    try {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", ENCODED_COMMAND],
        { windowsHide: true, timeout: SINGLE_CALL_TIMEOUT_MS },
        (err, stdout, _stderr) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (err) {
            consecutiveFailures++;
            systemLog.warn(
              `[powerState] PowerShell 调用失败 (连续 ${consecutiveFailures} 次):`,
              err.message,
            );
            resolve(null);
            return;
          }
          const trimmed = (stdout || "").trim();
          const parts = trimmed.split(",");
          if (parts.length < 3) {
            consecutiveFailures++;
            systemLog.warn(
              `[powerState] PowerShell 输出格式异常 (连续 ${consecutiveFailures} 次):`,
              trimmed,
            );
            resolve(null);
            return;
          }
          const acLine = Number.parseInt(parts[0], 10);
          const percent = Number.parseInt(parts[1], 10);
          const flag = Number.parseInt(parts[2], 10);
          // ACLineStatus: 0=离线, 1=在线, 255=未知；非 1 视为离线（电池供电）
          const isOnBattery = acLine !== 1;
          // BatteryLifePercent: 0-100, 255=未知；未知保守取 100
          const batteryPercent = percent >= 0 && percent <= 100 ? percent : 100;
          // SystemStatusFlag: 1=省电模式启用；其他视为正常
          const isPowerSave = flag === 1;
          // 成功：清零失败计数
          consecutiveFailures = 0;
          resolve({ isPowerSave, isOnBattery, batteryPercent });
        },
      );
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        systemLog.warn("[powerState] PowerShell 启动异常:", err);
        resolve(null);
      }
    }
  });
};

/**
 * macOS / Linux 回退：使用 Electron powerMonitor 判断电池供电
 *
 * 这两个平台没有 Windows Battery Saver 概念，将"使用电池"视为省电信号
 * Electron 的 powerMonitor 不暴露电池百分比，batteryPercent 保守返回 100
 * （仅作为 UI 展示占位；isPowerSave 由 isOnBattery 决定）
 */
const queryFallbackPowerState = (): PowerStateSnapshot => {
  const isOnBattery = powerMonitor.isOnBatteryPower();
  return {
    isPowerSave: isOnBattery,
    isOnBattery,
    batteryPercent: 100,
  };
};

/**
 * 查询一次电源状态
 *
 * - Windows：调用 PowerShell（异步）
 * - macOS / Linux：同步读 powerMonitor
 *
 * @returns 当前快照；查询失败时返回上次缓存或保守值
 */
export const getPowerStateOnce = async (): Promise<PowerStateSnapshot> => {
  if (process.platform === "win32") {
    const snapshot = await queryWindowsPowerState();
    if (snapshot) {
      latestSnapshot = snapshot;
      return snapshot;
    }
    // Windows 调用失败：回退到上次缓存或保守值
    if (latestSnapshot) return latestSnapshot;
    return { isPowerSave: false, isOnBattery: false, batteryPercent: 100 };
  }
  // 非 Windows 平台
  const snapshot = queryFallbackPowerState();
  latestSnapshot = snapshot;
  return snapshot;
};

/**
 * 通知所有监听器状态变化
 *
 * 仅在快照内容变化时触发回调（避免每 5s 重复回调相同状态）
 */
const notifyListeners = (snapshot: PowerStateSnapshot): void => {
  const prev = latestSnapshot;
  latestSnapshot = snapshot;
  if (
    prev &&
    prev.isPowerSave === snapshot.isPowerSave &&
    prev.isOnBattery === snapshot.isOnBattery &&
    prev.batteryPercent === snapshot.batteryPercent
  ) {
    return;
  }
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      systemLog.warn("[powerState] 监听器异常:", err);
    }
  }
};

/** 一次轮询：查询 + 通知 + 失败计数 */
const pollOnce = async (): Promise<void> => {
  if (polling) return;
  polling = true;
  try {
    const snapshot = await getPowerStateOnce();
    // 判断本次是否成功：getPowerStateOnce 在失败时返回缓存或保守值，
    // 需要通过 queryWindowsPowerState 的成功与否判断。这里用 snapshot 是否来自
    // 最新查询来判断——简化为：调用完成后 consecutiveFailures 由 queryWindowsPowerState 维护
    notifyListeners(snapshot);
  } finally {
    polling = false;
  }
};

/**
 * 计算下次轮询间隔（含 backoff）
 *
 * 连续失败时指数退避：interval * 2^n，上限 MAX_BACKOFF_MS
 * 成功时恢复到 DEFAULT_POLL_INTERVAL_MS
 */
const computeNextInterval = (): number => {
  if (consecutiveFailures === 0) return currentIntervalMs;
  const backoff = currentIntervalMs * Math.pow(2, consecutiveFailures);
  return Math.min(backoff, MAX_BACKOFF_MS);
};

/** 递归调度下一次轮询 */
const scheduleNextPoll = (): void => {
  const interval = computeNextInterval();
  pollTimer = setTimeout(() => {
    void pollOnce().finally(() => {
      if (pollTimer) scheduleNextPoll();
    });
  }, interval);
  pollTimer.unref?.();
};

/**
 * 启动轮询
 *
 * @param intervalMs 轮询间隔（毫秒），默认 60000
 */
export const startPolling = (intervalMs: number = DEFAULT_POLL_INTERVAL_MS): void => {
  if (pollTimer) {
    // 间隔变更时重启
    if (intervalMs === currentIntervalMs) return;
    stopPolling();
  }
  currentIntervalMs = intervalMs;
  consecutiveFailures = 0;
  // 立即触发一次，避免冷启动延迟 intervalMs 才有第一帧状态
  void pollOnce().finally(() => {
    if (pollTimer === null) scheduleNextPoll();
  });
  systemLog.info(`[powerState] 轮询已启动，基础间隔 ${currentIntervalMs}ms`);
};

/** 停止轮询 */
export const stopPolling = (): void => {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
    systemLog.info("[powerState] 轮询已停止");
  }
};

/**
 * 订阅电源状态变化
 *
 * @param listener 状态变化回调
 * @returns 取消订阅函数
 */
export const onPowerStateChange = (listener: PowerStateListener): (() => void) => {
  listeners.add(listener);
  // 已有缓存状态时立即回调一次
  if (latestSnapshot) {
    try {
      listener(latestSnapshot);
    } catch (err) {
      systemLog.warn("[powerState] 监听器初始回调异常:", err);
    }
  }
  return () => {
    listeners.delete(listener);
  };
};

/**
 * 取最近一次缓存的电源状态
 *
 * 用于 IPC 同步返回（避免每次都触发 PowerShell 调用）
 */
export const getCachedPowerState = async (): Promise<PowerStateSnapshot> => {
  if (latestSnapshot) return latestSnapshot;
  return getPowerStateOnce();
};

/**
 * 释放资源：停止轮询 + 清空监听器
 *
 * 应在 app.before-quit 中调用
 */
export const dispose = (): void => {
  stopPolling();
  listeners.clear();
  latestSnapshot = null;
};
