/**
 * 歌词行切换的帧驱动交叉淡化
 * 参照 WinIsland src/core/render.rs 的 lyric 渲染逻辑：
 * - 旧歌词：opacity = 1 - progress，水平模糊 sigma = progress * 12
 * - 新歌词：opacity = progress，水平模糊 sigma = (1 - progress) * 12
 * - Y 位移：旧歌词 -progress * 10，新歌词 (1 - progress) * 10
 * - 推进速度：0.05 * dt（约 20 帧 ≈ 333ms 完成）
 *
 * 与原 CSS transition（200ms 淡出 + 200ms 淡入）的差异：
 * - 旧/新同时在场，无空白期
 * - 水平模糊掩盖文本宽度跳变
 * - Y 位移制造"上推"错觉
 */
import { ref, onBeforeUnmount, type Ref } from "vue";

export interface LyricTransitionState {
  /** 0~1，0=旧歌词完全可见，1=新歌词完全可见 */
  progress: Ref<number>;
  /** 旧歌词水平模糊 sigma（响应式） */
  oldBlurSigma: Ref<number>;
  /** 新歌词水平模糊 sigma（响应式） */
  newBlurSigma: Ref<number>;
  /** 旧歌词 Y 位移（响应式，px） */
  oldOffsetY: Ref<number>;
  /** 新歌词 Y 位移（响应式，px） */
  newOffsetY: Ref<number>;
  /** 旧歌词透明度 */
  oldOpacity: Ref<number>;
  /** 新歌词透明度 */
  newOpacity: Ref<number>;
  /** 是否正在过渡（progress > 0 且 < 1） */
  active: Ref<boolean>;
  /** 触发一次过渡（外部已更新内容） */
  trigger: () => void;
  /** 跳过动画立即完成 */
  complete: () => void;
}

export interface LyricTransitionOptions {
  /** 推进速度系数（每 dt 单位推进量），默认 0.05 */
  speed?: number;
  /** 最大水平模糊 sigma（px），默认 12 */
  maxBlurSigma?: number;
  /** 最大 Y 位移（px），默认 10 */
  maxOffsetY?: number;
}

export function useLyricTransition(options?: LyricTransitionOptions): LyricTransitionState {
  const { speed = 0.05, maxBlurSigma = 12, maxOffsetY = 10 } = options ?? {};

  const progress = ref(1);
  const oldBlurSigma = ref(0);
  const newBlurSigma = ref(0);
  const oldOffsetY = ref(0);
  const newOffsetY = ref(0);
  const oldOpacity = ref(0);
  const newOpacity = ref(1);
  const active = ref(false);

  let rafId: number | null = null;
  let lastTime = 0;

  const applyProgress = (p: number): void => {
    oldOpacity.value = 1 - p;
    newOpacity.value = p;
    oldBlurSigma.value = p * maxBlurSigma;
    newBlurSigma.value = (1 - p) * maxBlurSigma;
    oldOffsetY.value = -p * maxOffsetY;
    newOffsetY.value = (1 - p) * maxOffsetY;
    active.value = p > 0 && p < 1;
  };

  applyProgress(1);

  const tick = (time: number): void => {
    if (lastTime === 0) lastTime = time;
    const elapsed = time - lastTime;
    lastTime = time;
    const dt = Math.min(3, Math.max(0.1, (elapsed * 60) / 1000));

    progress.value = Math.min(1, progress.value + speed * dt);
    applyProgress(progress.value);

    if (progress.value >= 1) {
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const trigger = (): void => {
    progress.value = 0;
    applyProgress(0);
    if (rafId !== null) cancelAnimationFrame(rafId);
    lastTime = performance.now();
    rafId = requestAnimationFrame(tick);
  };

  const complete = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    progress.value = 1;
    applyProgress(1);
  };

  onBeforeUnmount(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
  });

  return {
    progress,
    oldBlurSigma,
    newBlurSigma,
    oldOffsetY,
    newOffsetY,
    oldOpacity,
    newOpacity,
    active,
    trigger,
    complete,
  };
}
