/**
 * 3D 视差倾斜效果
 * 参照 BetterLyrics 的封面视差效果，鼠标移动时封面跟随倾斜
 * RAF 节流：mousemove 高频触发，getBoundingClientRect 强制 layout，
 * 节流到屏幕刷新率避免布局抖动
 */

interface ParallaxTiltOptions {
  /** 最大倾斜角度（度），默认 8 */
  maxTilt?: number;
  /** 透视距离（px），默认 800 */
  perspective?: number;
}

export function useParallaxTilt(options: ParallaxTiltOptions = {}) {
  const { maxTilt = 8, perspective = 800 } = options;

  const tiltX = ref(0);
  const tiltY = ref(0);
  const isHovering = ref(false);

  /** 计算倾斜 CSS transform */
  const tiltStyle = computed(() => {
    if (!isHovering.value) {
      return `perspective(${perspective}px) rotateX(0deg) rotateY(0deg)`;
    }
    return `perspective(${perspective}px) rotateX(${tiltX.value}deg) rotateY(${tiltY.value}deg)`;
  });

  /** RAF 节流句柄 */
  let rafId: number | null = null;
  /** 待处理的事件 */
  let pendingEvent: MouseEvent | null = null;
  /** 同步捕获的 currentTarget——事件结束后浏览器会重置 event.currentTarget 为 null，必须在事件处理期内取出 */
  let pendingTarget: HTMLElement | null = null;

  /** 在 RAF 中应用倾斜，避免高频 mousemove 触发布局抖动 */
  const applyTilt = (): void => {
    rafId = null;
    const event = pendingEvent;
    const target = pendingTarget;
    pendingEvent = null;
    pendingTarget = null;
    if (!event || !target) return;
    const rect = target.getBoundingClientRect();
    // 鼠标相对元素中心的归一化位置 [-1, 1]
    const x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    const y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    // rotateX 绕 X 轴旋转（上下倾斜），rotateY 绕 Y 轴旋转（左右倾斜）
    tiltX.value = -y * maxTilt;
    tiltY.value = x * maxTilt;
    isHovering.value = true;
  };

  /** 鼠标移动时计算倾斜角度（RAF 节流） */
  const onMouseMove = (event: MouseEvent): void => {
    pendingEvent = event;
    // 同步捕获 currentTarget——RAF 回调时 event.currentTarget 已被浏览器重置为 null
    pendingTarget = event.currentTarget as HTMLElement | null;
    if (rafId === null) {
      rafId = requestAnimationFrame(applyTilt);
    }
  };

  /** 鼠标离开时复位 */
  const onMouseLeave = (): void => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    pendingEvent = null;
    pendingTarget = null;
    tiltX.value = 0;
    tiltY.value = 0;
    isHovering.value = false;
  };

  return { tiltStyle, onMouseMove, onMouseLeave };
}
