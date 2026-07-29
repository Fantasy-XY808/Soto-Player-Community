<script setup lang="ts">
/**
 * SCard3D 3D 鼠标跟随卡片
 *
 * 移植自 Inspira UI 的 3d-card 设计：
 * - 鼠标在卡片上移动时，根据相对位置应用 rotateX / rotateY 透视变换
 * - 鼠标离开后回到中位，带 spring 过渡
 *
 * 实现：纯 CSS perspective + transform-style: preserve-3d，
 * 不引入 motion-v / gsap 等重型依赖。
 *
 * 根元素（.s-card-3d-wrapper）同时承担 hover 监听与原生事件透传，
 * 父组件可直接 @click / @mouseenter 等使用。
 *
 * 用法：
 *   <SCard3D :intensity="10" @click="handleClick">
 *     <div class="p-6">...</div>
 *   </SCard3D>
 */

interface Props {
  /** 旋转强度（度数，越大越夸张） */
  intensity?: number;
  /** 透视距离（px，越小越夸张） */
  perspective?: number;
  /** 是否启用悬浮阴影 */
  glow?: boolean;
  /** 是否透明背景（无 surface-panel 背景，仅 3D 透视效果） */
  transparent?: boolean;
  /** 容器自定义类 */
  containerClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  intensity: 8,
  perspective: 1000,
  glow: true,
  transparent: false,
  containerClass: "",
});

const wrapperRef = ref<HTMLElement | null>(null);
const transform = ref<string>("rotateX(0deg) rotateY(0deg)");
const isHover = ref(false);

// mousemove 节流：Home 页 60+ 张 CoverCard 同时存在时，
// 鼠标滑动会触发数十张卡的 mousemove，每次 getBoundingClientRect + 重建 transform 字符串
// 都会引发 reflow。用 requestAnimationFrame 合并到每帧一次，避免拖累主线程。
let rafId: number | null = null;
let lastEvent: MouseEvent | null = null;

const applyTransform = (): void => {
  rafId = null;
  const e = lastEvent;
  lastEvent = null;
  if (!e || !wrapperRef.value) return;
  const rect = wrapperRef.value.getBoundingClientRect();
  // 计算 -0.5 ~ 0.5 的相对位置
  const relX = (e.clientX - rect.left) / rect.width - 0.5;
  const relY = (e.clientY - rect.top) / rect.height - 0.5;
  // rotateY 由 X 轴位置驱动（鼠标在右侧时卡片向右倾斜）
  // rotateX 由 Y 轴位置驱动（鼠标在下方时卡片向上倾斜）
  const rotY = relX * props.intensity * 2;
  const rotX = -relY * props.intensity * 2;
  transform.value = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
  isHover.value = true;
};

const handleMouseMove = (event: MouseEvent): void => {
  lastEvent = event;
  if (rafId !== null) return;
  rafId = requestAnimationFrame(applyTransform);
};

const handleMouseLeave = (): void => {
  // 取消尚未渲染的帧，避免离开后 transform 又被覆写
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  lastEvent = null;
  transform.value = "rotateX(0deg) rotateY(0deg)";
  isHover.value = false;
};

onBeforeUnmount(() => {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
});

/** 容器样式：透视距离由 prop 控制 */
const containerStyle = computed(() => ({
  perspective: `${props.perspective}px`,
}));

/** 卡片样式：preserve-3d + 旋转，hover 时取消 transform 过渡以跟随鼠标，
 *  但保留 box-shadow 过渡让 glow 阴影平滑浮现/消失 */
const cardStyle = computed(() => ({
  transform: transform.value,
  transformStyle: "preserve-3d" as const,
  transition: isHover.value
    ? "box-shadow 0.3s ease-out"
    : "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease-out",
}));
</script>

<template>
  <div
    ref="wrapperRef"
    :class="['s-card-3d-wrapper', containerClass]"
    :style="containerStyle"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
  >
    <div
      class="s-card-3d bg-surface-panel"
      :class="{
        glow: glow && isHover,
        transparent: transparent,
      }"
      :style="cardStyle"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.s-card-3d-wrapper {
  display: inline-block;
  width: 100%;
}

.s-card-3d {
  position: relative;
  /* 圆角继承父级 wrapper，避免 wrapper 与卡片圆角不一致导致 hover 底框与卡片形状错位 */
  border-radius: inherit;
  border: 1px solid rgb(var(--s-outline-variant) / 0.18);
  box-shadow:
    0 4px 16px rgb(0 0 0 / 0.08),
    inset 0 1px 0 rgb(var(--s-on-surface) / 0.06);
  will-change: transform;
}

/* 透明模式：仅保留 3D 透视效果，无背景/边框/阴影，
   适合已有自定义样式的子组件（如 CoverCard）。
   注意：必须显式关闭 backdrop-filter 与 ::before/::after，
   否则液态玻璃主题下 .bg-surface-panel 仍会给本卡片叠加玻璃模糊 + 高光 + 描边 */
.s-card-3d.transparent {
  background-color: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: none;
  box-shadow: none;
}

.s-card-3d.transparent::before,
.s-card-3d.transparent::after {
  display: none;
}

.s-card-3d.transparent.glow {
  box-shadow: 0 12px 40px rgb(0 0 0 / 0.18);
}

.s-card-3d.glow {
  box-shadow:
    0 12px 40px rgb(0 0 0 / 0.22),
    0 0 0 1px rgb(var(--s-primary) / 0.18),
    inset 0 1px 0 rgb(var(--s-on-surface) / 0.12),
    0 0 32px rgb(var(--s-primary) / 0.12);
}

/* 暗色主题降低背景透明度让 3D 透视更明显 */
html.dark .s-card-3d {
  box-shadow:
    0 6px 20px rgb(0 0 0 / 0.4),
    inset 0 1px 0 rgb(var(--s-on-surface) / 0.08);
}

html.dark .s-card-3d.glow {
  box-shadow:
    0 16px 48px rgb(0 0 0 / 0.5),
    0 0 0 1px rgb(var(--s-primary) / 0.25),
    inset 0 1px 0 rgb(var(--s-on-surface) / 0.15),
    0 0 48px rgb(var(--s-primary) / 0.18);
}
</style>
