/**
 * useRafFn 适配器
 *
 * VueUse 的 useRafFn 内部走 requestAnimationFrame，离屏窗口 show:false 时被 Chromium
 * 节流到 ~1Hz。本适配器在渲染窗口环境下用 setTimeout 链式调度替代，保证 BackgroundRender
 * 的 FFT 循环、PlayerCover 的视差 tick、AMLLLyrics 的 update 等动画在渲染窗口下正常运转。
 *
 * 主窗口保持原 useRafFn 行为不变。
 *
 * 回调签名与 VueUse useRafFn 一致：({ timestamp, delta }) => void
 * 渲染窗口下 delta 由 setTimeout 间隔推算，timestamp 用 performance.now()。
 */

import { useRafFn as useRafFnOriginal, type UseRafFnOptions } from "@vueuse/core";
import { isVideoRenderer } from "@/composables/useVideoRendererFlag";

/** VueUse useRafFn 回调签名 */
type RafFnCallback = (args: { timestamp: number; delta: number }) => void;

interface LoopState {
  timeoutId: ReturnType<typeof setTimeout> | null;
  lastTimestamp: number;
}

/**
 * 创建 setTimeout 驱动的 RAF 替代循环
 *
 * @param callback 帧回调（接收 { timestamp, delta }）
 * @param intervalMs 调度间隔（ms），默认 16ms（约 60fps）
 */
const useSetTimeoutLoop = (
  callback: RafFnCallback,
  intervalMs = 16,
): { resume: () => void; pause: () => void } => {
  const state: LoopState = { timeoutId: null, lastTimestamp: 0 };
  let running = false;

  const tick = (): void => {
    if (!running) return;
    const now = performance.now();
    const delta = state.lastTimestamp > 0 ? now - state.lastTimestamp : intervalMs;
    state.lastTimestamp = now;
    callback({ timestamp: now, delta });
    state.timeoutId = setTimeout(tick, intervalMs);
  };

  const resume = (): void => {
    if (running) return;
    running = true;
    state.lastTimestamp = 0;
    tick();
  };

  const pause = (): void => {
    running = false;
    if (state.timeoutId) {
      clearTimeout(state.timeoutId);
      state.timeoutId = null;
    }
  };

  return { resume, pause };
};

/**
 * 适配 useRafFn：渲染窗口下用 setTimeout 替代 RAF
 *
 * @param callback 帧回调（接收 { timestamp, delta }）
 * @param options RafFnOptions（immediate 等）
 */
export const useRafFn = (
  callback: RafFnCallback,
  options?: UseRafFnOptions,
): { resume: () => void; pause: () => void } => {
  // 渲染窗口：用 setTimeout 替代
  if (isVideoRenderer()) {
    return useSetTimeoutLoop(callback);
  }
  // 主窗口：走 VueUse 原 useRafFn
  return useRafFnOriginal(callback, options);
};
