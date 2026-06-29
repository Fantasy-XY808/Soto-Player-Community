import { onScopeDispose, ref, watch } from "vue";
import { useStatusStore } from "@/stores/status";
import { getFftFrame } from "@/services/playback";
import { acquireFft, releaseFft } from "@/services/fftCapture";

/** Attack 系数:上升时 EMA 平滑因子,响应迅速 */
const ATTACK = 0.2;
/** Decay 系数:下降时 EMA 平滑因子,缓慢回落营造拖尾感 */
const DECAY = 0.05;
/** 低频段数(约 80-90Hz,贝斯基频区) */
const LOW_BINS = 4;
/** 静音阈值,低于此值视作无能量 */
const THRESHOLD = 0.05;
/** 最大 scale offset,8% 放大上限 */
const MAX_SCALE_OFFSET = 0.08;
/**
 * 帧间隔(ms):FFT 后端推送频率 30Hz(32ms),RAF 对齐到 30fps
 * 60fps RAF 会做一半无意义插值(数据未更新),CPU 翻倍且 scale 抖动
 */
const FRAME_INTERVAL = 32;

/** 模块级共享:引用计数 */
let refCount = 0;
/** 模块级共享:FFT 是否已申请 */
let fftAcquired = false;
/** 模块级共享:RAF 句柄 */
let rafId = 0;
/** 模块级共享:当前 scale(非响应式内部变量) */
let currentScale = 1.0;
/** 模块级共享:FullPlayer 是否展开 */
let isAnyExpanded = false;
/** 模块级共享:是否正在播放(暂停时停止 RAF + 释放 FFT) */
let isAnyPlaying = false;
/** 上次 tick 时间戳,用于 30fps 节流 */
let lastTickTime = 0;

/** 共享响应式 scale,所有调用者读取同一份 */
const scale = ref(1.0);

/** 单帧 FFT 计算 + EMA 平滑(30fps 节流) */
const tick = (ts: number): void => {
  // 30fps 节流:与后端 FFT 推送频率对齐,避免 60fps 冗余插值
  if (ts - lastTickTime < FRAME_INTERVAL) {
    rafId = requestAnimationFrame(tick);
    return;
  }
  lastTickTime = ts;
  const data = getFftFrame();
  if (data && data.length > 0) {
    let sum = 0;
    const len = Math.min(LOW_BINS, data.length);
    for (let i = 0; i < len; i++) sum += data[i] ?? 0;
    const avg = sum / len;
    const normalized = Math.max(0, (avg - THRESHOLD) / (1.0 - THRESHOLD));
    const rawValue = Math.pow(normalized, 1.5);
    const target = 1.0 + rawValue * MAX_SCALE_OFFSET;
    // 非对称 EMA:上升用 ATTACK(快),下降用 DECAY(慢)
    if (target > currentScale) {
      currentScale += (target - currentScale) * ATTACK;
    } else {
      currentScale += (target - currentScale) * DECAY;
    }
    scale.value = currentScale;
  }
  rafId = requestAnimationFrame(tick);
};

/** 启动 RAF(幂等) */
const startRaf = (): void => {
  if (rafId) return;
  lastTickTime = 0;
  rafId = requestAnimationFrame(tick);
};

/** 停止 RAF 并复位 scale */
const stopRaf = (): void => {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  currentScale = 1.0;
  scale.value = 1.0;
};

/** 根据引用计数 + 展开状态 + 播放状态同步 RAF 与 FFT 申请 */
const sync = (): void => {
  // 暂停或收起时:停止 RAF,释放 FFT(隐藏即静默,高频推送不达隐藏窗口)
  if (refCount > 0 && isAnyExpanded && isAnyPlaying) {
    if (!fftAcquired) {
      acquireFft();
      fftAcquired = true;
    }
    startRaf();
  } else {
    stopRaf();
    if (fftAcquired) {
      releaseFft();
      fftAcquired = false;
    }
  }
};

/** 申请 breathing:引用计数 +1,必要时启动 RAF */
const acquire = (): void => {
  refCount++;
  sync();
};

/** 释放 breathing:引用计数 -1,必要时停止 RAF */
const release = (): void => {
  if (refCount === 0) return;
  refCount--;
  sync();
};

/**
 * 节拍呼吸 composable
 *
 * 订阅 FFT 低频段,计算非对称 EMA scale(attack 0.2 / decay 0.05),
 * 供背景特效接入节拍感。多个组件共享同一份 scale 与 FFT 引用计数。
 *
 * 调用即视为申请:setup 中调用一次,组件卸载时自动释放。
 * 自动响应 FullPlayer 展开/收起 + 播放/暂停:任一为否时停止 RAF 并释放 FFT,
 * 避免隐藏窗口或暂停时仍消耗高频推送与渲染。
 *
 * RAF 节流到 30fps 与后端 FFT 推送对齐,避免 60fps 冗余插值。
 *
 * @returns 共享 scale(1.0 ~ 1.08)
 */
export function useBreathing() {
  const status = useStatusStore();

  // 多次 watch 冗余但幂等,只更新模块级状态并触发 sync
  const stop1 = watch(
    () => status.isExpanded,
    (val) => {
      isAnyExpanded = val;
      sync();
    },
    { immediate: true },
  );
  const stop2 = watch(
    () => status.isPlaying,
    (val) => {
      isAnyPlaying = val;
      sync();
    },
    { immediate: true },
  );

  acquire();

  onScopeDispose(() => {
    stop1();
    stop2();
    release();
  });

  return { scale };
}
