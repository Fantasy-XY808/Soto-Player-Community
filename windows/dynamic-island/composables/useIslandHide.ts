/**
 * 灵动岛隐藏状态机
 * 参照 WinIsland src/window/app.rs 的 hide 相关逻辑：
 * - 自动隐藏：N 秒无交互后 hide 弹簧目标 → 1
 * - 拖拽隐藏：向下拖拽超过阈值触发隐藏
 * - 隐藏坨儿：隐藏后保留小段可见区域（handle），悬停/点击展开
 *
 * 本 composable 仅维护 isHidden 状态与计时器；实际的 Y 位移/透明度由
 * useIslandLayout 的 hide 弹簧驱动（hide_target = isHidden ? 1 : 0）
 */
import { ref, watch, onBeforeUnmount, type Ref, type ComputedRef } from "vue";

export interface IslandHideOptions {
  /** 是否启用自动隐藏 */
  autoHide: Ref<boolean> | ComputedRef<boolean>;
  /** 自动隐藏延迟（秒） */
  autoHideDelay: Ref<number> | ComputedRef<number>;
  /** 隐藏触发的拖拽阈值（px，向下拖拽超过此值触发） */
  dragHideThreshold?: number;
}

export interface IslandHideResult {
  /** 是否隐藏 */
  isHidden: Ref<boolean>;
  /** 重置自动隐藏计时（用户交互时调用；如已隐藏则同时展开） */
  resetActivity: () => void;
  /** 立即隐藏 */
  hide: () => void;
  /** 立即显示 */
  show: () => void;
  /** 切换 */
  toggle: () => void;
  /** 拖拽过程中检测是否触发隐藏（返回 true 表示已触发） */
  checkDragHide: (deltaY: number) => boolean;
}

export function useIslandHide(options: IslandHideOptions): IslandHideResult {
  const { autoHide, autoHideDelay, dragHideThreshold = 80 } = options;

  const isHidden = ref(false);
  let autoHideTimer: number | null = null;

  const clearTimer = (): void => {
    if (autoHideTimer !== null) {
      window.clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  };

  const startTimer = (): void => {
    clearTimer();
    if (!autoHide.value) return;
    const delaySec = Math.max(0.5, autoHideDelay.value);
    autoHideTimer = window.setTimeout(() => {
      isHidden.value = true;
      autoHideTimer = null;
    }, delaySec * 1000);
  };

  const resetActivity = (): void => {
    if (isHidden.value) {
      isHidden.value = false;
    }
    startTimer();
  };

  const hide = (): void => {
    isHidden.value = true;
    clearTimer();
  };

  const show = (): void => {
    if (isHidden.value) {
      isHidden.value = false;
    }
    startTimer();
  };

  const toggle = (): void => {
    if (isHidden.value) show();
    else hide();
  };

  const checkDragHide = (deltaY: number): boolean => {
    if (deltaY >= dragHideThreshold) {
      hide();
      return true;
    }
    return false;
  };

  // 自动隐藏开关或延迟变化时重启计时（已隐藏态保持，等用户主动展开）
  watch([autoHide, autoHideDelay], () => {
    if (isHidden.value) return;
    startTimer();
  });

  startTimer();

  onBeforeUnmount(clearTimer);

  return {
    isHidden,
    resetActivity,
    hide,
    show,
    toggle,
    checkDragHide,
  };
}
