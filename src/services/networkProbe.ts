import { ref } from "vue";

/**
 * 网络质量状态
 */
export type NetworkQuality = "good" | "poor" | "offline";

interface NetworkState {
  online: boolean;
  quality: NetworkQuality;
}

/** 当前网络状态 */
export const networkState = ref<NetworkState>({ online: true, quality: "good" });

/** 上次探测时间戳 */
let lastProbeAt = 0;
/** 是否正在探测中，防止并发 */
let isProbing = false;
/** 等待探测完成的回调队列 */
const probeWaiters: Array<(state: NetworkState) => void> = [];

/** 探测间隔（毫秒） */
const PROBE_INTERVAL_MS = 30_000;
/** 探测超时（毫秒） */
const PROBE_TIMEOUT_MS = 3_000;
/** 判定为网络不好的 RTT 阈值（毫秒） */
const POOR_RTT_THRESHOLD_MS = 1_500;

/**
 * 探测网络质量
 *
 * 优先走主进程 `bilibili.song_url` 模块（其内部走 BV→cid→playurl 通路，
 * 与本项目实际音源解析路径一致，能反映真实可用带宽）；
 * 主进程 IPC 不可用时回落到直接 fetch Bilibili 搜索页（受 CORS 限制可能失败）。
 *
 * @returns 探测到的网络质量
 */
const probeNetworkQuality = async (): Promise<NetworkQuality> => {
  if (typeof navigator !== "undefined" && !navigator.onLine) return "offline";
  const start = performance.now();
  try {
    if (window.api?.apis?.call) {
      // 主进程代理：song_url 对 BV1xx411c7mD（经典测试视频）的取流往返能反映跨网段时延
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      try {
        await window.api.apis.call("bilibili", "song_url", {
          trackId: "BV1xx411c7mD",
        });
      } finally {
        clearTimeout(timer);
      }
    } else {
      // 兜底：直接 fetch Bilibili 搜索页（Electron 渲染进程受 CORS 限制可能直接失败）
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
      try {
        await fetch("https://www.bilibili.com", {
          method: "HEAD",
          signal: ctrl.signal,
          mode: "no-cors",
        });
      } finally {
        clearTimeout(timer);
      }
    }
    const rtt = performance.now() - start;
    return rtt > POOR_RTT_THRESHOLD_MS ? "poor" : "good";
  } catch (err) {
    console.warn("[networkProbe] probe failed:", err);
    return "offline";
  }
};

/**
 * 获取当前网络状态
 * 带缓存：30 秒内重复调用直接返回缓存结果；并发调用共享同一次探测
 * @returns 网络状态
 */
export const getNetworkState = async (): Promise<NetworkState> => {
  const now = Date.now();
  if (lastProbeAt !== 0 && now - lastProbeAt < PROBE_INTERVAL_MS) {
    return { ...networkState.value };
  }
  if (isProbing) {
    return new Promise<NetworkState>((resolve) => {
      probeWaiters.push(resolve);
    });
  }
  isProbing = true;
  try {
    const quality = await probeNetworkQuality();
    networkState.value = { online: quality !== "offline", quality };
    lastProbeAt = Date.now();
    const result = { ...networkState.value };
    while (probeWaiters.length > 0) {
      const waiter = probeWaiters.shift();
      if (waiter) waiter(result);
    }
    return result;
  } catch (err) {
    console.warn("[networkProbe] getNetworkState failed:", err);
    networkState.value = { online: false, quality: "offline" };
    lastProbeAt = Date.now();
    const result = { ...networkState.value };
    while (probeWaiters.length > 0) {
      const waiter = probeWaiters.shift();
      if (waiter) waiter(result);
    }
    return result;
  } finally {
    isProbing = false;
  }
};

/**
 * 强制刷新网络状态
 * 忽略缓存间隔，立即重新探测
 */
export const refreshNetworkState = async (): Promise<NetworkState> => {
  lastProbeAt = 0;
  return getNetworkState();
};

/**
 * 监听浏览器在线/离线事件，自动更新状态
 * @returns 清理函数，用于移除事件监听
 */
export const startNetworkMonitoring = (): (() => void) => {
  const handleOnline = (): void => {
    networkState.value.online = true;
    void refreshNetworkState();
  };
  const handleOffline = (): void => {
    networkState.value = { online: false, quality: "offline" };
    // 离线状态也视为已探测，避免频繁重试
    lastProbeAt = Date.now();
  };
  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  return (): void => {
    window.removeEventListener("online", handleOnline);
    window.removeEventListener("offline", handleOffline);
  };
};
