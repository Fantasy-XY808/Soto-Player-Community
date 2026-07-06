/**
 * 共享 RAF 调度器
 *
 * 把多个高频绘制循环（流体/雾气/雪花/雨滴背景、频谱等）合并到一个 requestAnimationFrame
 * 回调里，按订阅者各自的 interval 节流分发。文档隐藏时整体停止，可见时恢复。
 *
 * 收益：
 * - N 个组件共享 1 个 RAF 回调，省下 N-1 个 rAF tick 的 JS 调度开销
 * - 单点 visibilitychange 监听，组件不再各自绑/解绑
 * - 便于后续扩展全局帧率预算（低电量降帧、调试埋点等）
 */

interface Subscriber {
  /** 帧回调（now = performance.now()） */
  callback: (now: number) => void;
  /** 目标帧间隔（ms）；0 表示每帧都调用 */
  interval: number;
  /** 上次调用时间戳，用于节流 */
  lastCall: number;
  /** 唯一 id，用于取消订阅 */
  id: number;
}

const subscribers: Subscriber[] = [];
let rafId = 0;
let nextId = 1;
let running = false;
/** 用户手动暂停标志：visible 时也保持停止；document.hidden 也会触发停止但 resume 不应越过它 */
let paused = false;

const tick = (now: number): void => {
  if (!running) return;
  // 文档隐藏时整体停止；visibilitychange 恢复时由 ensureRunning 重启
  if (document.hidden) {
    rafId = 0;
    running = false;
    return;
  }
  // 快照避免迭代过程中增删订阅导致越界
  const snapshot = subscribers.slice();
  for (let i = 0; i < snapshot.length; i++) {
    const sub = snapshot[i];
    if (now - sub.lastCall >= sub.interval) {
      sub.lastCall = now;
      sub.callback(now);
    }
  }
  if (running) rafId = requestAnimationFrame(tick);
};

const ensureRunning = (): void => {
  if (running || subscribers.length === 0) return;
  if (paused || document.hidden) return;
  running = true;
  rafId = requestAnimationFrame(tick);
};

const stop = (): void => {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
};

/**
 * 订阅共享 RAF
 * @param callback 帧回调（now = performance.now()）
 * @param interval 目标帧间隔（ms）；0 表示每帧都调用，常用值：32ms ≈ 30fps
 * @returns 取消订阅函数
 */
export const subscribeRaf = (callback: (now: number) => void, interval = 0): (() => void) => {
  const id = nextId++;
  const sub: Subscriber = { callback, interval, lastCall: 0, id };
  subscribers.push(sub);
  ensureRunning();
  return () => {
    const idx = subscribers.findIndex((s) => s.id === id);
    if (idx >= 0) subscribers.splice(idx, 1);
    if (subscribers.length === 0) stop();
  };
};

/**
 * 高优先级 RAF 订阅：不做节流，每帧都调用
 * 适用于必须紧跟刷新率的场景（如逐字高亮、精确同步动画）
 * @param callback 帧回调（now = performance.now()）
 * @returns 取消订阅函数
 */
export const subscribeRafHigh = (callback: (now: number) => void): (() => void) =>
  subscribeRaf(callback, 0);

/**
 * 全局暂停所有 RAF 订阅
 * 窗口隐藏或需要释放主线程时调用；不影响订阅本身，恢复后继续推进
 */
export const pauseAllRaf = (): void => {
  paused = true;
  stop();
};

/**
 * 从手动暂停中恢复；document 仍隐藏时不重启（等 visibilitychange 触发）
 */
export const resumeAllRaf = (): void => {
  if (!paused) return;
  paused = false;
  // 重置 lastCall，避免恢复时一次性补帧
  for (const sub of subscribers) sub.lastCall = 0;
  ensureRunning();
};

/** 当前活跃订阅数量，用于诊断与性能监控 */
export const getActiveSubscriberCount = (): number => subscribers.length;

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stop();
    } else if (!paused) {
      // 重置 lastCall，避免恢复时一次性补帧
      for (const sub of subscribers) sub.lastCall = 0;
      ensureRunning();
    }
  });
}
