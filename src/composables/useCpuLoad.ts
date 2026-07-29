import type { ComputedRef, Ref } from "vue";

/**
 * CPU 负载 composable
 *
 * 用于 prefetch 动态阈值（C-2）：
 * - cpuLoad > 0.8：阈值 × 1.3（CPU 紧张时提前预加载，避免切歌时解码抢占 CPU）
 * - cpuLoad < 0.5 且网络为 wifi：阈值 × 0.8（CPU 空闲 + 快网络，缩短预加载窗口省内存）
 *
 * 模块级共享：多个组件 / 服务订阅同一份状态，仅触发一次 IPC 初始化。
 */
const cpuLoad = ref(0);

/** 是否已初始化（避免多个调用方同时触发 IPC 订阅） */
let initialized = false;

/**
 * 初始化：拉取一次初始负载 + 订阅主进程推送事件
 *
 * 多次调用幂等，仅在首次调用时执行实际订阅。
 */
const init = (): void => {
  if (initialized) return;
  initialized = true;

  // 拉取初始负载（主进程可能已缓存，否则返回 load=0）
  void window.api.system.getCpuLoad().then((snapshot) => {
    cpuLoad.value = snapshot.load;
  });

  // 订阅后续变化（5s 轮询，变化 > 2% 才推送）
  window.api.system.onCpuLoadChanged((snapshot) => {
    cpuLoad.value = snapshot.load;
  });
};

/**
 * CPU 负载 composable
 *
 * @returns cpuLoad: 0~1 的综合 CPU 使用率（所有核心平均）
 */
export const useCpuLoad = (): { cpuLoad: Ref<number> } => {
  init();
  return { cpuLoad };
};

/**
 * 派生：CPU 是否处于高负载（> 0.8）
 *
 * 供需要"高负载降级"语义的调用方使用，避免散落 magic number
 */
export const useIsCpuHighLoad = (): { isHighLoad: ComputedRef<boolean> } => {
  init();
  const isHighLoad = computed(() => cpuLoad.value > 0.8);
  return { isHighLoad };
};
