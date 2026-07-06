/**
 * 3D 视差倾斜效果
 * 参照 BetterLyrics 的封面视差效果，鼠标移动时封面跟随倾斜
 * 共享 RAF 调度器节流：mousemove 高频触发，getBoundingClientRect 强制 layout，
 * 通过 subscribeRaf 订阅共享 RAF 在屏幕刷新率应用倾斜，避免布局抖动且与背景层共用 RAF
 *
 * lerp 平滑：mousemove 只更新 target，RAF 帧里 tiltX += (target - tiltX) * 0.15，
 * 鼠标快速移动时不再硬切；收敛后自动退订避免空转
 */

import { subscribeRaf } from "@/services/rafScheduler";

interface ParallaxTiltOptions {
  /** 最大倾斜角度（度），默认 8 */
  maxTilt?: number;
  /** 透视距离（px），默认 800 */
  perspective?: number;
  /** lerp 缓动系数，越大越跟手，越小越柔和，默认 0.15 */
  easing?: number;
}

export function useParallaxTilt(options: ParallaxTiltOptions = {}) {
  const { maxTilt = 8, perspective = 800, easing = 0.15 } = options;

  const tiltX = ref(0);
  const tiltY = ref(0);
  const isHovering = ref(false);

  /** 目标 tilt 值：mousemove 直接写入，RAF 时 lerp 逼近 */
  let targetTiltX = 0;
  let targetTiltY = 0;

  /** 计算倾斜 CSS transform */
  const tiltStyle = computed(() => {
    if (!isHovering.value) {
      return `perspective(${perspective}px) rotateX(0deg) rotateY(0deg)`;
    }
    return `perspective(${perspective}px) rotateX(${tiltX.value}deg) rotateY(${tiltY.value}deg)`;
  });

  /** 共享 RAF 订阅取消函数；非空表示正在订阅 */
  let unsubscribe: (() => void) | null = null;
  /** 待处理的事件 */
  let pendingEvent: MouseEvent | null = null;
  /** 同步捕获的 currentTarget——事件结束后浏览器会重置 event.currentTarget 为 null，必须在事件处理期内取出 */
  let pendingTarget: HTMLElement | null = null;

  /** 在共享 RAF 回调中应用倾斜，避免高频 mousemove 触发布局抖动 */
  const applyTilt = (): void => {
    const event = pendingEvent;
    const target = pendingTarget;
    pendingEvent = null;
    pendingTarget = null;
    if (event && target) {
      const rect = target.getBoundingClientRect();
      // 鼠标相对元素中心的归一化位置 [-1, 1]
      const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      // rotateX 绕 X 轴旋转（上下倾斜），rotateY 绕 Y 轴旋转（左右倾斜）
      targetTiltX = -y * maxTilt;
      targetTiltY = x * maxTilt;
      isHovering.value = true;
    }
    // lerp 平滑：每帧逼近目标，鼠标快速移动时不硬切
    const dx = targetTiltX - tiltX.value;
    const dy = targetTiltY - tiltY.value;
    // 收敛到 0.05° 内且无新事件时停止订阅，避免空转
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05 && !pendingEvent) {
      tiltX.value = targetTiltX;
      tiltY.value = targetTiltY;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      return;
    }
    tiltX.value += dx * easing;
    tiltY.value += dy * easing;
  };

  /** 鼠标移动时记录事件并订阅共享 RAF（若尚未订阅） */
  const onMouseMove = (event: MouseEvent): void => {
    pendingEvent = event;
    // 同步捕获 currentTarget——RAF 回调时 event.currentTarget 已被浏览器重置为 null
    pendingTarget = event.currentTarget as HTMLElement | null;
    if (!unsubscribe) {
      unsubscribe = subscribeRaf(applyTilt, 0);
    }
  };

  /** 鼠标离开时取消订阅并复位 */
  const onMouseLeave = (): void => {
    pendingEvent = null;
    pendingTarget = null;
    // 目标归零，让 RAF 把 tilt 平滑过渡到 0 后自动退订
    targetTiltX = 0;
    targetTiltY = 0;
    isHovering.value = false;
    if (!unsubscribe) {
      unsubscribe = subscribeRaf(applyTilt, 0);
    }
  };

  onBeforeUnmount(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  });

  return { tiltStyle, onMouseMove, onMouseLeave };
}
