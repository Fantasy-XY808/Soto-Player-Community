import { computed, ref, onMounted, onBeforeUnmount, type Ref, type ComputedRef } from "vue";

/**
 * 全局视口尺寸响应式状态
 *
 * 提供多档断点供组件适配极端窗口尺寸：
 * - xs (<480px): 极端窄窗口（接近 Electron minWidth:600）
 * - sm (480-639px): 窄窗口
 * - md (640-767px): 中等窗口
 * - lg (768-1023px): 标准桌面
 * - xl (1024-1279px): 大屏
 * - 2xl (>=1280px): 超宽屏
 *
 * 与 UnoCSS breakpoints 对齐（见 uno.config.ts）
 */

// 模块级单例：所有组件共享同一份视口状态
const viewportWidth = ref(typeof window !== "undefined" ? window.innerWidth : 1280);
const viewportHeight = ref(typeof window !== "undefined" ? window.innerHeight : 800);
let listenerCount = 0;
let resizeHandler: (() => void) | null = null;

const ensureListener = (): void => {
  if (listenerCount === 0) {
    resizeHandler = (): void => {
      viewportWidth.value = window.innerWidth;
      viewportHeight.value = window.innerHeight;
    };
    window.addEventListener("resize", resizeHandler, { passive: true });
  }
  listenerCount++;
};

const removeListener = (): void => {
  listenerCount = Math.max(0, listenerCount - 1);
  if (listenerCount === 0 && resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
  }
};

export interface ViewportState {
  /** 视口宽度（只读，勿直接修改） */
  width: Ref<number>;
  /** 视口高度（只读，勿直接修改） */
  height: Ref<number>;
  isXs: ComputedRef<boolean>;
  isSm: ComputedRef<boolean>;
  isMd: ComputedRef<boolean>;
  isLg: ComputedRef<boolean>;
  isXl: ComputedRef<boolean>;
  is2xl: ComputedRef<boolean>;
  /** 极端窄窗口（<800px，对齐主窗口 minWidth）：需要 compact 布局 */
  isCompact: ComputedRef<boolean>;
  /** 极端纵长比（高度远大于宽度）：需要切换为上下堆叠布局 */
  isPortrait: ComputedRef<boolean>;
  /** 极端横宽比（宽度远大于高度）：需要限制内容最大宽度 */
  isUltrawide: ComputedRef<boolean>;
}

/**
 * 获取全局视口尺寸响应式状态
 * 在 onMounted 时自动注册监听，onBeforeUnmount 时自动注销
 *
 * 注意：返回的 width/height 是共享的模块级 ref，勿直接修改其 value
 */
export const useViewport = (): ViewportState => {
  const isXs = computed(() => viewportWidth.value < 480);
  const isSm = computed(() => viewportWidth.value >= 480 && viewportWidth.value < 640);
  const isMd = computed(() => viewportWidth.value >= 640 && viewportWidth.value < 768);
  const isLg = computed(() => viewportWidth.value >= 768 && viewportWidth.value < 1024);
  const isXl = computed(() => viewportWidth.value >= 1024 && viewportWidth.value < 1280);
  const is2xl = computed(() => viewportWidth.value >= 1280);

  const isCompact = computed(() => viewportWidth.value < 800);
  const isPortrait = computed(
    () => viewportHeight.value > viewportWidth.value * 1.3 && viewportWidth.value < 768,
  );
  const isUltrawide = computed(
    () => viewportWidth.value > viewportHeight.value * 2.2 && viewportHeight.value < 600,
  );

  onMounted(ensureListener);
  onBeforeUnmount(removeListener);

  return {
    width: viewportWidth,
    height: viewportHeight,
    isXs,
    isSm,
    isMd,
    isLg,
    isXl,
    is2xl,
    isCompact,
    isPortrait,
    isUltrawide,
  };
};
