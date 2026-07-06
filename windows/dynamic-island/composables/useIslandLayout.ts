/**
 * 灵动岛多弹簧编排器
 * 参照 WinIsland src/window/app.rs 的 App 结构体：5 个独立弹簧共享一个 RAF tick
 * - spring_w/h/r：尺寸/圆角，目标为实际像素值
 * - spring_view：页面位移 0~1（music ↔ widget），单页时恒为 0
 * - spring_hide：隐藏进度 0~1
 *
 * 弹簧参数（对齐 WinIsland src/window/app.rs 的 about_to_wait 调用）：
 * - w/h/r：stiffness=0.10, damping=0.68
 * - view：stiffness=0.12, damping=0.68
 * - hide：visible 时 (0.08, 0.78)，hidden 时 (0.12, 0.70)
 *
 * dt 归一化到 60fps 基准（dt≈1），clamp 到 [0.1, 3.0] 避免长帧发散
 */
import { ref, onBeforeUnmount, type Ref } from "vue";

export interface IslandSpringTargets {
  width?: number;
  height?: number;
  radius?: number;
  view?: number;
  hide?: number;
}

export interface IslandLayoutResult {
  /** 当前宽度（响应式，px） */
  width: Ref<number>;
  /** 当前高度（响应式，px） */
  height: Ref<number>;
  /** 当前圆角（响应式，px） */
  radius: Ref<number>;
  /** 页面位移进度（响应式，0~1） */
  view: Ref<number>;
  /** 隐藏进度（响应式，0~1） */
  hide: Ref<number>;
  /** 速度读取器（非响应式，用于运动模糊与状态判断） */
  velocityW: () => number;
  velocityH: () => number;
  velocityView: () => number;
  velocityHide: () => number;
  /** 设置目标值，未传入的字段保持原目标 */
  setTargets: (targets: IslandSpringTargets) => void;
  /** 立即跳转到指定值，无动画 */
  jumpTo: (targets: IslandSpringTargets) => void;
  /** 给指定弹簧施加速度冲量（按钮按压/释放效果） */
  impulse: (which: "view" | "hide", velocity: number) => void;
  /** 停止所有动画 */
  stop: () => void;
}

interface SpringState {
  value: number;
  velocity: number;
  target: number;
  stiffness: number;
  damping: number;
}

const createSpring = (initial: number, stiffness: number, damping: number): SpringState => ({
  value: initial,
  velocity: 0,
  target: initial,
  stiffness,
  damping,
});

const updateSpring = (s: SpringState, dt: number): void => {
  const force = (s.target - s.value) * s.stiffness * dt;
  s.velocity = (s.velocity + force) * Math.pow(s.damping, dt);
  s.value += s.velocity * dt;
  if (!Number.isFinite(s.value)) {
    s.value = s.target;
    s.velocity = 0;
  }
  if (!Number.isFinite(s.velocity)) s.velocity = 0;
};

const isSettled = (s: SpringState): boolean =>
  Math.abs(s.velocity) < 0.0001 && Math.abs(s.target - s.value) < 0.0001;

const snapToTarget = (s: SpringState): void => {
  s.value = s.target;
  s.velocity = 0;
};

export interface IslandLayoutOptions {
  initialWidth: number;
  initialHeight: number;
  initialRadius: number;
  /** hide 弹簧参数：隐藏态使用更硬的刚度快速收起 */
  hideStiffnessHidden?: number;
  hideDampingHidden?: number;
  hideStiffnessVisible?: number;
  hideDampingVisible?: number;
}

export function useIslandLayout(options: IslandLayoutOptions): IslandLayoutResult {
  const {
    initialWidth,
    initialHeight,
    initialRadius,
    hideStiffnessHidden = 0.12,
    hideDampingHidden = 0.7,
    hideStiffnessVisible = 0.08,
    hideDampingVisible = 0.78,
  } = options;

  const width = ref(initialWidth);
  const height = ref(initialHeight);
  const radius = ref(initialRadius);
  const view = ref(0);
  const hide = ref(0);

  const springW = createSpring(initialWidth, 0.1, 0.68);
  const springH = createSpring(initialHeight, 0.1, 0.68);
  const springR = createSpring(initialRadius, 0.1, 0.68);
  const springView = createSpring(0, 0.12, 0.68);
  const springHide = createSpring(0, hideStiffnessVisible, hideDampingVisible);

  let rafId: number | null = null;
  let lastTime = 0;

  const tick = (time: number): void => {
    if (lastTime === 0) lastTime = time;
    const elapsed = time - lastTime;
    lastTime = time;
    const dt = Math.min(3, Math.max(0.1, (elapsed * 60) / 1000));

    // hide 弹簧参数随状态切换（隐藏态更硬，展开态更软）
    if (springHide.target > 0.5) {
      springHide.stiffness = hideStiffnessHidden;
      springHide.damping = hideDampingHidden;
    } else {
      springHide.stiffness = hideStiffnessVisible;
      springHide.damping = hideDampingVisible;
    }

    updateSpring(springW, dt);
    updateSpring(springH, dt);
    updateSpring(springR, dt);
    updateSpring(springView, dt);
    updateSpring(springHide, dt);

    width.value = springW.value;
    height.value = springH.value;
    radius.value = springR.value;
    view.value = springView.value;
    hide.value = springHide.value;

    const allSettled =
      isSettled(springW) &&
      isSettled(springH) &&
      isSettled(springR) &&
      isSettled(springView) &&
      isSettled(springHide);

    if (allSettled) {
      snapToTarget(springW);
      snapToTarget(springH);
      snapToTarget(springR);
      snapToTarget(springView);
      snapToTarget(springHide);
      width.value = springW.value;
      height.value = springH.value;
      radius.value = springR.value;
      view.value = springView.value;
      hide.value = springHide.value;
      rafId = null;
      return;
    }
    rafId = requestAnimationFrame(tick);
  };

  const ensureRaf = (): void => {
    if (rafId === null) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  };

  const setTargets = (targets: IslandSpringTargets): void => {
    if (targets.width !== undefined) springW.target = targets.width;
    if (targets.height !== undefined) springH.target = targets.height;
    if (targets.radius !== undefined) springR.target = targets.radius;
    if (targets.view !== undefined) springView.target = targets.view;
    if (targets.hide !== undefined) springHide.target = targets.hide;
    ensureRaf();
  };

  const jumpTo = (targets: IslandSpringTargets): void => {
    if (targets.width !== undefined) {
      springW.target = targets.width;
      springW.value = targets.width;
      springW.velocity = 0;
      width.value = targets.width;
    }
    if (targets.height !== undefined) {
      springH.target = targets.height;
      springH.value = targets.height;
      springH.velocity = 0;
      height.value = targets.height;
    }
    if (targets.radius !== undefined) {
      springR.target = targets.radius;
      springR.value = targets.radius;
      springR.velocity = 0;
      radius.value = targets.radius;
    }
    if (targets.view !== undefined) {
      springView.target = targets.view;
      springView.value = targets.view;
      springView.velocity = 0;
      view.value = targets.view;
    }
    if (targets.hide !== undefined) {
      springHide.target = targets.hide;
      springHide.value = targets.hide;
      springHide.velocity = 0;
      hide.value = targets.hide;
    }
  };

  const impulse = (which: "view" | "hide", velocity: number): void => {
    const s = which === "view" ? springView : springHide;
    s.velocity += velocity;
    ensureRaf();
  };

  const stop = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  onBeforeUnmount(stop);

  return {
    width,
    height,
    radius,
    view,
    hide,
    velocityW: () => springW.velocity,
    velocityH: () => springH.velocity,
    velocityView: () => springView.velocity,
    velocityHide: () => springHide.velocity,
    setTargets,
    jumpTo,
    impulse,
    stop,
  };
}
