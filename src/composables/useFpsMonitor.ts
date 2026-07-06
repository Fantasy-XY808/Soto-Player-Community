import type { Ref } from "vue";
import { subscribeRaf } from "@/services/rafScheduler";

/** 帧率采样窗口（毫秒）—— 每秒结算一次 FPS */
const SAMPLE_INTERVAL_MS = 1000;
/** 触发自动降级的低帧阈值（连续 N 秒低于此值时降级特效） */
const LOW_FPS_THRESHOLD = 45;
/** 触发 CoverDepthOfField 降级的严重低帧阈值 */
const SEVERE_FPS_THRESHOLD = 30;

/**
 * 全屏播放器帧率监控
 *
 * 每秒结算一次 FPS，统计连续低帧秒数；用于驱动特效自动降级。
 * 接入共享 RAF 调度器，避免独立 RAF 循环。
 *
 * @param active - 是否激活监控（如播放器展开且至少有一个特效开启时）
 * @returns fps / lowFpsCount / severeLowFpsCount / reset
 */
export const useFpsMonitor = (active: Ref<boolean>) => {
  const fps = ref(60);
  const lowFpsCount = ref(0);
  const severeLowFpsCount = ref(0);

  let frameCount = 0;
  let lastSampleAt = 0;
  let unsubscribe: (() => void) | null = null;

  const sample = (now: number): void => {
    frameCount++;
    if (now - lastSampleAt >= SAMPLE_INTERVAL_MS) {
      const elapsed = now - lastSampleAt;
      const current = Math.round((frameCount * 1000) / elapsed);
      fps.value = current;
      lowFpsCount.value = current < LOW_FPS_THRESHOLD ? lowFpsCount.value + 1 : 0;
      severeLowFpsCount.value = current < SEVERE_FPS_THRESHOLD ? severeLowFpsCount.value + 1 : 0;
      frameCount = 0;
      lastSampleAt = now;
    }
  };

  const start = (): void => {
    if (unsubscribe) return;
    frameCount = 0;
    lastSampleAt = performance.now();
    // interval=0：每帧计数，但共享调度器已合并到单 RAF
    unsubscribe = subscribeRaf(sample, 0);
  };

  const stop = (): void => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  /** 重置冷却计数（用户手动重开特效后调用，避免立即再次降级） */
  const reset = (): void => {
    lowFpsCount.value = 0;
    severeLowFpsCount.value = 0;
  };

  watch(
    active,
    (on) => {
      if (on) start();
      else {
        stop();
        reset();
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => stop());

  return { fps, lowFpsCount, severeLowFpsCount, reset };
};
