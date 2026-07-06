/**
 * FFT 频谱推送的引用计数
 *
 * 频谱可视化与流体背景都依赖后端 FFT 推送，但 player:setFftEnabled 是单一布尔开关。
 * 用引用计数协调多个消费者：首个申请时开启推送，最后一个释放时才关闭，
 * 避免一个组件卸载时误关掉另一个仍在使用的推送。
 *
 * visibilitychange 强制暂停：窗口隐藏时即便仍有消费者持引用，也强制关掉推送，
 * 避免无意义的 IPC 与解码开销；窗口可见时若引用计数仍 > 0 则恢复。
 */

/** 当前持有 FFT 推送的消费者数量 */
let refCount = 0;
/** visibility 强制暂停标志：hidden 时为 true，覆盖引用计数语义 */
let forcePaused = false;

/** 申请 FFT 推送；首个消费者负责开启后端推送 */
export const acquireFft = (): void => {
  refCount++;
  if (refCount === 1 && !forcePaused) {
    window.api.player.setFftEnabled(true);
  }
};

/** 释放 FFT 推送；最后一个消费者关闭后端推送 */
export const releaseFft = (): void => {
  if (refCount === 0) return;
  refCount--;
  if (refCount === 0 && !forcePaused) {
    window.api.player.setFftEnabled(false);
  }
};

/**
 * 强制暂停 FFT 推送（窗口隐藏时调用）
 * 即使仍有消费者持引用也立即关闭，恢复时若引用计数 > 0 自动重启
 */
export const forcePauseFft = (): void => {
  if (forcePaused) return;
  forcePaused = true;
  if (refCount > 0) window.api.player.setFftEnabled(false);
};

/**
 * 从强制暂停中恢复（窗口可见时调用）
 * 引用计数 > 0 时重新开启推送
 */
export const resumeFromForcePause = (): void => {
  if (!forcePaused) return;
  forcePaused = false;
  if (refCount > 0) window.api.player.setFftEnabled(true);
};
