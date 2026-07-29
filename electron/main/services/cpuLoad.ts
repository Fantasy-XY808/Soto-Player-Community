import { cpus } from "node:os";
import { systemLog } from "@main/utils/logger";

/**
 * CPU 负载轮询服务
 *
 * 用于 prefetch 动态阈值（C-2）：cpuLoad > 0.8 时将预加载阈值 × 1.3，
 * cpuLoad < 0.5 且网络为 wifi 时 × 0.8。
 *
 * 设计要点（与 powerState 一致）：
 * - 单例：模块内 cache 一个 latest 状态 + listeners 集合
 * - 5s 轮询：CPU 采样本身需要 1s（两次 os.cpus() 间隔），5s 间隔让单次测量
 *   占用约 0.02% CPU；用户感知延迟 5s 完全可接受
 * - 变化 < 2% 不通知：避免高频 IPC 干扰渲染进程
 * - 单次采样 1s 间隔：太短噪声大，太长阻塞轮询
 */

/** CPU 负载快照 */
export interface CpuLoadSnapshot {
  /** 综合 CPU 使用率 0~1（所有核心平均） */
  load: number;
}

/** CPU 负载变化监听器 */
type CpuLoadListener = (snapshot: CpuLoadSnapshot) => void;

/** 默认轮询间隔（毫秒） */
const DEFAULT_POLL_INTERVAL_MS = 5_000;
/** 单次采样间隔（毫秒）：两次 os.cpus() 之间需要间隔以计算差值 */
const SAMPLE_INTERVAL_MS = 1_000;
/** 变化阈值（0~1）：负载变化小于此值不通知，避免高频 IPC */
const NOTIFY_DELTA = 0.02;

/** 仅取需要的 times 字段，避免持有可能被 Node 重新计算的引用 */
interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

/** 当前最新 CPU 负载快照；null 表示尚未采样过 */
let latestSnapshot: CpuLoadSnapshot | null = null;

/** 监听器集合 */
const listeners = new Set<CpuLoadListener>();

/** 轮询定时器 */
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** 当前轮询间隔（毫秒） */
let currentIntervalMs = DEFAULT_POLL_INTERVAL_MS;

/** 是否在采样中（一次采样耗时 1s，避免重叠） */
let polling = false;

/** 把 os.cpus() 的 times 摘出来，便于差值计算 */
const snapshotTimes = (): CpuTimes[] => {
  return cpus().map((c) => ({
    user: c.times.user,
    nice: c.times.nice,
    sys: c.times.sys,
    idle: c.times.idle,
    irq: c.times.irq,
  }));
};

/** 计算单核总时间（用于差值） */
const sumTimes = (t: CpuTimes): number => t.user + t.nice + t.sys + t.idle + t.irq;

/**
 * 计算两组 times 之间的 CPU 使用率
 *
 * 公式：1 - (idle 差值 / 总时间差值)
 * - 单核：直接计算
 * - 多核：累加所有核心的 idle 差值 / 累加所有核心的总时间差值 = 综合平均
 */
const computeUsage = (prev: CpuTimes[], curr: CpuTimes[]): number => {
  const len = Math.min(prev.length, curr.length);
  if (len === 0) return 0;
  let idleDiff = 0;
  let totalDiff = 0;
  for (let i = 0; i < len; i++) {
    idleDiff += Math.max(0, curr[i].idle - prev[i].idle);
    totalDiff += Math.max(0, sumTimes(curr[i]) - sumTimes(prev[i]));
  }
  if (totalDiff <= 0) return 0;
  const usage = 1 - idleDiff / totalDiff;
  // clamp 到 [0, 1] 避免边界异常
  return Math.max(0, Math.min(1, usage));
};

/**
 * 单次测量：取两次 os.cpus() 间隔 1s 的差值
 *
 * @returns 0~1 的 CPU 使用率；采样失败返回 null
 */
const measureOnce = async (): Promise<number | null> => {
  const prev = snapshotTimes();
  if (prev.length === 0) return null;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, SAMPLE_INTERVAL_MS);
    t.unref?.();
  });
  const curr = snapshotTimes();
  return computeUsage(prev, curr);
};

/**
 * 通知所有监听器负载变化
 *
 * 仅在快照 load 字段变化超过 NOTIFY_DELTA 时触发回调，
 * 避免 5s 一次的高频 IPC 干扰渲染进程
 */
const notifyListeners = (snapshot: CpuLoadSnapshot): void => {
  const prev = latestSnapshot;
  latestSnapshot = snapshot;
  if (prev && Math.abs(prev.load - snapshot.load) < NOTIFY_DELTA) return;
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (err) {
      systemLog.warn("[cpuLoad] 监听器异常:", err);
    }
  }
};

/** 一次轮询：测量 + 通知 */
const pollOnce = async (): Promise<void> => {
  if (polling) return;
  polling = true;
  try {
    const load = await measureOnce();
    if (load === null) return;
    notifyListeners({ load });
  } finally {
    polling = false;
  }
};

/**
 * 启动轮询
 *
 * @param intervalMs 轮询间隔（毫秒），默认 5000
 */
export const startPolling = (intervalMs: number = DEFAULT_POLL_INTERVAL_MS): void => {
  if (pollTimer) {
    if (intervalMs === currentIntervalMs) return;
    stopPolling();
  }
  currentIntervalMs = intervalMs;
  // 立即触发一次，避免冷启动延迟 intervalMs 才有第一帧状态
  void pollOnce();
  pollTimer = setInterval(() => {
    void pollOnce();
  }, currentIntervalMs);
  pollTimer?.unref?.();
  systemLog.info(`[cpuLoad] 轮询已启动，间隔 ${currentIntervalMs}ms`);
};

/** 停止轮询 */
export const stopPolling = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    systemLog.info("[cpuLoad] 轮询已停止");
  }
};

/**
 * 订阅 CPU 负载变化
 *
 * @param listener 负载变化回调
 * @returns 取消订阅函数
 */
export const onCpuLoadChange = (listener: CpuLoadListener): (() => void) => {
  listeners.add(listener);
  // 已有缓存状态时立即回调一次
  if (latestSnapshot) {
    try {
      listener(latestSnapshot);
    } catch (err) {
      systemLog.warn("[cpuLoad] 监听器初始回调异常:", err);
    }
  }
  return () => {
    listeners.delete(listener);
  };
};

/**
 * 取最近一次缓存的 CPU 负载
 *
 * 用于 IPC 同步返回（避免每次都触发 1s 采样）
 * 无缓存时返回 load=0，下一次轮询会推送真实值
 */
export const getCachedCpuLoad = (): CpuLoadSnapshot => {
  return latestSnapshot ?? { load: 0 };
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
