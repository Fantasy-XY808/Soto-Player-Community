/**
 * 扇形歌词子句动画引擎
 *
 * 提供子句（背景和声、对唱副部）展开时的关键帧与缓动函数计算。
 * - fade：opacity 0 → 目标
 * - slide：translateY 偏移 → 0（按 direction 决定方向）
 * - spring：Web Animations API 弹簧物理（不在 CSS transition 中处理）
 * - scale：transform scale(0.8) → scale(1)
 *
 * 错峰延迟：delay × index（index=0 为最靠近主句的子句）
 */

/** 子句动画类型 */
export type SubLineAnimationType = "fade" | "slide" | "spring" | "scale";

/** 子句缓动函数 */
export type SubLineEasing = "easeOut" | "easeInOut" | "easeOutBack" | "cubicBezier";

/** 子句动画配置 */
export interface SubLineAnimationConfig {
  /** 动画类型 */
  type: SubLineAnimationType;
  /** 动画时长（毫秒） */
  duration: number;
  /** 错峰延迟（毫秒，按 index 递增） */
  delay: number;
  /** 缓动函数 */
  easing: SubLineEasing;
  /** 自定义贝塞尔控制点（仅 easing=cubicBezier 生效） */
  cubicBezier: [number, number, number, number];
  /** 子句展开方向 */
  direction: "up" | "down" | "both";
}

/** 默认 cubicBezier 控制点（easeOutQuint） */
export const DEFAULT_CUBIC_BEZIER: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** slide 动画的初始位移距离（px） */
const SLIDE_OFFSET_PX = 16;

/**
 * 根据子句索引和方向计算位移正负号
 * - up：所有子句向上展开（起始位置在下方，translateY 正值 → 0）
 * - down：所有子句向下展开（起始位置在上方，translateY 负值 → 0）
 * - both：偶数索引向上、奇数索引向下（或反之）
 * @param index 子句在组内的索引
 * @param direction 展开方向
 * @returns 起始 translateY 偏移（px，正=向下）
 */
const resolveSlideOffset = (
  index: number,
  direction: "up" | "down" | "both",
): number => {
  switch (direction) {
    case "up":
      // 起始在下方，向上移动到 0
      return SLIDE_OFFSET_PX;
    case "down":
      // 起始在上方，向下移动到 0
      return -SLIDE_OFFSET_PX;
    case "both": {
      // 上下交替：偶数索引向上、奇数索引向下
      // 注意：index=0 是最靠近主句的，所以正向偏移让"上方子句"先出现
      return index % 2 === 0 ? SLIDE_OFFSET_PX : -SLIDE_OFFSET_PX;
    }
  }
};

/**
 * 计算子句的初始 / 终末状态（用于 CSS transition 或 Web Animations API）
 *
 * @param index 子句在组内的索引（0=最靠近主句）
 * @param config 动画配置
 * @returns { from, to } CSS 属性对象
 */
export const computeSubLineKeyframes = (
  index: number,
  config: SubLineAnimationConfig,
): { from: Record<string, string>; to: Record<string, string> } => {
  switch (config.type) {
    case "fade":
      return {
        from: { opacity: "0" },
        to: { opacity: "1" },
      };
    case "slide": {
      const offset = resolveSlideOffset(index, config.direction);
      return {
        from: { transform: `translateY(${offset}px)`, opacity: "0" },
        to: { transform: "translateY(0px)", opacity: "1" },
      };
    }
    case "scale":
      return {
        from: { transform: "scale(0.8)", opacity: "0" },
        to: { transform: "scale(1)", opacity: "1" },
      };
    case "spring":
      // spring 类型用 Web Animations API 处理，CSS 仅做透明度过渡
      return {
        from: { opacity: "0" },
        to: { opacity: "1" },
      };
  }
};

/**
 * 生成 CSS transition 字符串
 *
 * @param config 动画配置
 * @returns CSS transition-value 字符串（如 "opacity 600ms ease-out, transform 600ms ease-out"）
 */
export const buildCSSTransition = (config: SubLineAnimationConfig): string => {
  const duration = `${config.duration}ms`;
  const easing = resolveEasing(config);
  const easingStr = typeof easing === "string" ? easing : `cubic-bezier(${easing.join(", ")})`;
  switch (config.type) {
    case "fade":
      return `opacity ${duration} ${easingStr}`;
    case "slide":
    case "scale":
      return `opacity ${duration} ${easingStr}, transform ${duration} ${easingStr}`;
    case "spring":
      // spring 类型不在 CSS transition 中处理位移，仅透明度
      return `opacity ${duration} ${easingStr}`;
  }
};

/**
 * 生成缓动函数（用于 Web Animations API）
 *
 * @param config 动画配置
 * @returns cubic-bezier 数组或预设字符串
 */
export const resolveEasing = (config: SubLineAnimationConfig): number[] | string => {
  switch (config.easing) {
    case "easeOut":
      // easeOutQuint
      return [0.22, 1, 0.36, 1];
    case "easeInOut":
      // easeInOutCubic
      return [0.65, 0, 0.35, 1];
    case "easeOutBack":
      // easeOutBack（轻微回弹）
      return [0.34, 1.56, 0.64, 1];
    case "cubicBezier":
      return config.cubicBezier;
  }
};

/**
 * 计算子句错峰延迟（毫秒）
 * @param index 子句在组内的索引（0=最靠近主句）
 * @param config 动画配置
 * @returns 延迟毫秒数
 */
export const computeSubLineDelay = (
  index: number,
  config: SubLineAnimationConfig,
): number => config.delay * index;

/**
 * 构造 Web Animations API 关键帧数组（用于 spring 类型）
 *
 * @param index 子句索引
 * @param config 动画配置
 * @returns 关键帧数组
 */
export const buildSpringKeyframes = (
  index: number,
  config: SubLineAnimationConfig,
): Keyframe[] => {
  const offset = resolveSlideOffset(index, config.direction);
  return [
    { transform: `translateY(${offset}px) scale(0.85)`, opacity: "0", offset: 0 },
    { transform: "translateY(0px) scale(1.05)", opacity: "1", offset: 0.6 },
    { transform: "translateY(0px) scale(1)", opacity: "1", offset: 1 },
  ];
};
