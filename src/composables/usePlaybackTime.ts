import { getCurrentTime, getDuration, isPlaying } from "@/services/playback";
import { subscribeRaf } from "@/services/rafScheduler";

/**
 * 高频播放时间 composable
 *
 * 通过共享 RAF 调度器读取非响应式时间源，不触发 Vue 响应式系统。
 * 多个调用方共用 rafScheduler 的单一 RAF 回调，省去逐组件的 rAF tick 开销；
 * 文档隐藏时由调度器统一停摆，恢复时自动续跑。
 *
 * @param onTick 每帧回调，接收当前播放位置（毫秒，整数）和总时长（毫秒，整数）
 * @returns { start, stop } 手动控制 RAF 循环
 */
export const usePlaybackTime = (
  onTick: (currentMs: number, durationMs: number, playing: boolean) => void,
): { start: () => void; stop: () => void } => {
  let unsubscribe: (() => void) | null = null;

  const tick = (): void => {
    onTick(Math.round(getCurrentTime()), Math.round(getDuration()), isPlaying());
  };

  const start = (): void => {
    if (unsubscribe) return;
    // interval=33：30fps 足够歌词逐字高亮，与 FFT 推送对齐
    // 原来每帧(0ms)调用对歌词视觉无提升，但增加 2x JS 调度开销
    unsubscribe = subscribeRaf(tick, 33);
  };

  const stop = (): void => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };

  onUnmounted(stop);

  return { start, stop };
};
