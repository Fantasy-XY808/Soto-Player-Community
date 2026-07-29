/**
 * RGB 神光同步核心 composable
 *
 * 职责：
 * - 订阅 FFT 频谱数据（复用 fftCapture 的 acquireFft/releaseFft 引用计数）
 * - 按配置 fps（10-60）节流采样
 * - 为每个启用的设备生成颜色帧
 * - 批量调用 window.api.openrgb.setColors(frames) 下发
 * - 窗口隐藏时暂停 interval 并 forcePauseFft，可见时恢复
 *
 * 模块级单例：status / devices / beatStates 跨组件共享。
 * init() 注册应用级 watcher：enabled=true 自动 start，false 自动 stop。
 * 需在应用入口（App.vue onMounted）调用 useRgbSync() 触发 init()。
 */

import { computed, ref, watch } from "vue";
import type {
  RgbColor,
  RgbDeviceInfo,
  RgbFrameData,
  RgbSyncStatus,
} from "@shared/types/rgbSync";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { getFftFrame } from "@/services/playback";
import { acquireFft, releaseFft } from "@/services/fftCapture";
import {
  computeBeat,
  computeColor,
  computeGradient,
  computeSpectrum,
  computeVu,
  createBeatState,
  hexToRgbColor,
  type BeatState,
} from "./rgbEffects";

/** 模块级单例：OpenRGB 连接状态 */
const status = ref<RgbSyncStatus>({ connected: false, devices: [] });
/** 模块级单例：同步循环是否运行 */
const running = ref(false);
/** 模块级单例：setInterval 句柄 */
let intervalId: ReturnType<typeof setInterval> | null = null;
/** 模块级单例：FFT 引用是否已申请 */
let fftAcquired = false;
/** 模块级单例：每个设备的节拍跨帧状态 */
const beatStates = new Map<number, BeatState>();
/** 模块级单例：visibilitychange 监听是否已安装 */
let visibilityInstalled = false;
/** 模块级单例：窗口隐藏暂停标志（hidden 时停止 interval） */
let hiddenPaused = false;
/** 模块级单例：是否已安装响应式 watcher（避免重复注册） */
let initialized = false;

/** 取当前 RGB 同步设置（settings.system 是 SystemConfig，rgbSync 是其顶层字段） */
const readSettings = () => useSettingsStore().system.rgbSync;

/** 取当前封面色（theme.coverColor 为 HEX 字符串或 null） */
const readCoverColor = (): RgbColor => {
  const theme = useThemeStore();
  return hexToRgbColor(theme.coverColor);
};

/** 取或创建设备的节拍跨帧状态 */
const ensureBeatState = (deviceId: number): BeatState => {
  let s = beatStates.get(deviceId);
  if (!s) {
    s = createBeatState();
    beatStates.set(deviceId, s);
  }
  return s;
};

/** 计算单设备一帧颜色，返回 RgbFrameData 或 null（设备未启用）
 * 亮度乘数由主进程 setColors 统一应用，渲染端不做缩放 */
const computeDeviceFrame = (
  device: RgbDeviceInfo,
  fft: readonly number[],
  coverColor: RgbColor,
  now: number,
): RgbFrameData | null => {
  const config = readSettings().devices[device.id];
  if (!config || !config.enabled) return null;

  let colors: RgbColor[];
  switch (config.effect) {
    case "spectrum":
      colors = computeSpectrum(fft, device.ledCount, config, coverColor);
      break;
    case "beat": {
      const state = ensureBeatState(device.id);
      colors = computeBeat(fft, device.ledCount, config, coverColor, state, now).colors;
      break;
    }
    case "color":
      colors = computeColor(device.ledCount, config, coverColor);
      break;
    case "gradient":
      colors = computeGradient(device.ledCount, config, now);
      break;
    case "vu":
      colors = computeVu(fft, device.ledCount, config);
      break;
    default:
      colors = new Array(device.ledCount).fill({ r: 0, g: 0, b: 0 });
  }

  return { deviceId: device.id, colors };
};

/** 单帧采样 + 批量下发 */
const tick = (): void => {
  if (hiddenPaused) return;
  const settings = readSettings();
  if (!settings.enabled || !status.value.connected) return;
  const devices = status.value.devices;
  if (devices.length === 0) return;

  const fft = getFftFrame();
  const coverColor = readCoverColor();
  const now = Date.now();

  const frames: RgbFrameData[] = [];
  for (const device of devices) {
    const frame = computeDeviceFrame(device, fft, coverColor, now);
    if (frame) frames.push(frame);
  }

  if (frames.length > 0) {
    void window.api.openrgb.setColors(frames).catch((err) => {
      console.error("[rgbSync] setColors failed", err);
    });
  }
};

/** 启动 interval（幂等） */
const startInterval = (fps: number): void => {
  if (intervalId !== null) return;
  const clamped = Math.max(10, Math.min(60, fps));
  intervalId = setInterval(tick, 1000 / clamped);
};

/** 停止 interval（幂等） */
const stopInterval = (): void => {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
};

/** visibilitychange 回调：hidden 时停 interval，visible 时恢复
 * FFT 的 forcePause/resume 由全局 useVisibilityPause 统一管理，此处不重复调用 */
const onVisibilityChange = (): void => {
  if (document.hidden) {
    hiddenPaused = true;
    stopInterval();
  } else {
    hiddenPaused = false;
    if (running.value) startInterval(readSettings().fps);
  }
};

const installVisibilityListener = (): void => {
  if (visibilityInstalled) return;
  visibilityInstalled = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
};

const uninstallVisibilityListener = (): void => {
  if (!visibilityInstalled) return;
  visibilityInstalled = false;
  document.removeEventListener("visibilitychange", onVisibilityChange);
};

/**
 * 启动同步循环
 *
 * 安装 visibility 监听、按配置 fps 启动 interval。
 * FFT 引用按需申请：仅在 OpenRGB 已连接且有设备时才 acquireFft，
 * 避免 enabled=true 但未连接时仍持续 20Hz 推送 FFT 造成整机卡顿。
 * 幂等：重复调用不会叠加 interval。
 */
const start = (): void => {
  if (running.value) return;
  installVisibilityListener();
  // 仅在已连接且有设备时申请 FFT；连接状态变化时由 watcher 同步
  if (!fftAcquired && status.value.connected && status.value.devices.length > 0) {
    acquireFft();
    fftAcquired = true;
  }
  hiddenPaused = document.hidden;
  if (!hiddenPaused) startInterval(readSettings().fps);
  running.value = true;
};

/**
 * 停止同步循环
 *
 * 停 interval、释放 FFT 引用、移除 visibility 监听。
 * 保留 beatStates 以便重启时延续衰减上下文。
 */
const stop = (): void => {
  if (!running.value) return;
  stopInterval();
  if (fftAcquired) {
    releaseFft();
    fftAcquired = false;
  }
  uninstallVisibilityListener();
  running.value = false;
};

/** 手动连接 OpenRGB 服务（使用 settings 中的 host/port） */
const connect = async (): Promise<void> => {
  const { host, port } = readSettings();
  try {
    const result = await window.api.openrgb.connect(host, port);
    status.value = result;
  } catch (err) {
    status.value = {
      connected: false,
      devices: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/** 断开 OpenRGB 连接 */
const disconnect = async (): Promise<void> => {
  try {
    await window.api.openrgb.disconnect();
  } finally {
    status.value = { connected: false, devices: [] };
  }
};

/** 重新拉取设备列表 */
const refreshDevices = async (): Promise<void> => {
  try {
    const devices = await window.api.openrgb.refreshDevices();
    status.value = { ...status.value, devices, error: undefined };
  } catch (err) {
    status.value = {
      ...status.value,
      error: err instanceof Error ? err.message : String(err),
    };
  }
};

/** 测试单设备颜色（覆盖当前效果，固化显示） */
const testColor = async (deviceId: number, color: RgbColor): Promise<void> => {
  await window.api.openrgb.testColor(deviceId, color);
};

/** 设备列表（computed 透传） */
const devices = computed<RgbDeviceInfo[]>(() => status.value.devices);

/**
 * 模块级初始化：安装应用级 watcher + 状态订阅
 *
 * - enabled watcher（immediate）：true → start()，false → stop()
 * - fps watcher：运行中变更时重启 interval
 * - 状态订阅：同步主进程连接/断开/设备列表变化
 * - 初始状态拉取：首次 init 时调 getStatus 获取当前连接快照
 *
 * 多次调用幂等，仅在首次调用时注册。watcher 不绑定组件 effect scope，
 * 作为应用级监听存活到进程退出。
 */
const init = (): void => {
  if (initialized) return;
  initialized = true;
  const settings = useSettingsStore();

  // 总开关 watcher（immediate）：true → start，false → stop
  watch(
    () => settings.system.rgbSync.enabled,
    (on) => {
      if (on) start();
      else stop();
    },
    { immediate: true },
  );

  // fps 变化时重启 interval（仅运行中且非隐藏暂停时）
  watch(
    () => settings.system.rgbSync.fps,
    (fps) => {
      if (running.value && !hiddenPaused) {
        stopInterval();
        startInterval(fps);
      }
    },
  );

  // OpenRGB 连接状态 watcher：连接且有设备时 acquireFft，断开时 releaseFft
  // 避免 enabled=true 但未连接时仍持续 20Hz 推送 FFT 造成整机卡顿
  watch(
    () => [status.value.connected, status.value.devices.length] as const,
    ([connected, deviceCount]) => {
      if (!running.value) return;
      if (connected && deviceCount > 0 && !fftAcquired) {
        acquireFft();
        fftAcquired = true;
      } else if ((!connected || deviceCount === 0) && fftAcquired) {
        releaseFft();
        fftAcquired = false;
      }
    },
  );

  // 拉取主进程当前连接状态（可能 applyConfigChange 已自动连接）
  void window.api.openrgb.getStatus().then((s) => {
    status.value = s;
  });

  // 订阅主进程下发的状态变化（应用级生命周期，无需取消订阅）
  window.api.openrgb.onStatusChange((next) => {
    // S3: 设备列表变化时清理孤立的 beatStates
    const currentIds = new Set(next.devices.map((d) => d.id));
    for (const id of beatStates.keys()) {
      if (!currentIds.has(id)) beatStates.delete(id);
    }
    status.value = next;
  });
};

/**
 * RGB 神光同步 composable
 *
 * @returns
 *   - status：OpenRGB 连接状态 ref
 *   - devices：设备列表 computed
 *   - connect / disconnect / refreshDevices / testColor：手动控制
 *   - start / stop：同步循环启停（设置页打开且总开关开启时调用 start）
 */
export function useRgbSync() {
  init();
  return {
    status,
    devices,
    connect,
    disconnect,
    refreshDevices,
    testColor,
    start,
    stop,
  };
}
