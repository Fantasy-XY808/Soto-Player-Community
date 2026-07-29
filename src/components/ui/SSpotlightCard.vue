<script setup lang="ts">
/**
 * SSpotlightCard 鼠标跟随聚光灯卡片
 *
 * 移植自 Inspira UI 的 spotlight-card 设计：
 * - 鼠标 hover 时，卡片表面跟随鼠标显示一个径向渐变光斑
 * - 卡片边框也带有跟随鼠标的高光描边
 * - 离开后光斑消失
 *
 * 实现：通过 CSS 自定义属性 --mx / --my 存储鼠标百分比位置，
 * 在内部两个 div（.s-spotlight-glow / .s-spotlight-border）中用 radial-gradient 引用，
 * 避免每帧重渲染 Vue 组件。
 *
 * 为什么不用 ::before / ::after：
 * 液态玻璃主题（html[data-theme-style="liquid-glass"] .bg-surface-panel::before/::after）
 * 会覆盖本组件的伪元素，导致辉光失效。改用真实 DOM 子元素绕开该冲突。
 *
 * 用法：
 *   <SSpotlightCard :radius="16" :size="400">
 *     <div class="p-6">...</div>
 *   </SSpotlightCard>
 */

interface Props {
  /** 圆角（px） */
  radius?: number;
  /** 光斑半径（px） */
  size?: number;
  /** 光斑颜色（CSS 颜色字符串） */
  color?: string;
  /** 是否启用边框追光 */
  borderGlow?: boolean;
  /** 容器自定义类 */
  containerClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  radius: 16,
  size: 400,
  color: "rgb(var(--s-primary) / 0.18)",
  borderGlow: true,
  containerClass: "",
});

const cardRef = ref<HTMLElement | null>(null);

const handleMouseMove = (event: MouseEvent): void => {
  if (!cardRef.value) return;
  const rect = cardRef.value.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  // 用 CSS 自定义属性传递，子元素直接引用
  cardRef.value.style.setProperty("--mx", `${x}px`);
  cardRef.value.style.setProperty("--my", `${y}px`);
  cardRef.value.style.setProperty("--mxp", `${(x / rect.width) * 100}%`);
  cardRef.value.style.setProperty("--myp", `${(y / rect.height) * 100}%`);
  cardRef.value.dataset.hover = "true";
};

const handleMouseLeave = (): void => {
  if (!cardRef.value) return;
  cardRef.value.dataset.hover = "false";
};

const cardStyle = computed(() => ({
  borderRadius: `${props.radius}px`,
  // CSS 变量由 mousemove 实时更新，子元素引用
  "--spotlight-size": `${props.size}px`,
  "--spotlight-color": props.color,
}));
</script>

<template>
  <div
    ref="cardRef"
    class="s-spotlight-card bg-surface-panel"
    :class="containerClass"
    :style="cardStyle"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
  >
    <!-- 内部光斑层：用真实 DOM 而非 ::before，避免与液态玻璃主题 .bg-surface-panel::before 冲突 -->
    <div class="s-spotlight-glow" aria-hidden="true" />
    <!-- 边框追光层：同上，避开 .bg-surface-panel::after -->
    <div v-if="borderGlow" class="s-spotlight-border" aria-hidden="true" />
    <slot />
  </div>
</template>

<style scoped>
.s-spotlight-card {
  position: relative;
  overflow: hidden;
  border: 1px solid rgb(var(--s-outline-variant) / 0.18);
  box-shadow:
    0 4px 16px rgb(0 0 0 / 0.08),
    inset 0 1px 0 rgb(var(--s-on-surface) / 0.06);
  /* 初始 --mx/--my 居中，避免 hover 前无光斑 */
  --mx: 50%;
  --my: 50%;
  --mxp: 50%;
  --myp: 50%;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.s-spotlight-card[data-hover="true"] {
  border-color: rgb(var(--s-primary) / 0.32);
  box-shadow:
    0 8px 28px rgb(0 0 0 / 0.14),
    inset 0 1px 0 rgb(var(--s-on-surface) / 0.1);
}

/* 内部光斑：径向渐变跟随鼠标 */
.s-spotlight-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s ease;
  background: radial-gradient(
    var(--spotlight-size, 400px) circle at var(--mxp, 50%) var(--myp, 50%),
    var(--spotlight-color, rgb(var(--s-primary) / 0.18)),
    transparent 70%
  );
  border-radius: inherit;
  z-index: 1;
}

.s-spotlight-card[data-hover="true"] .s-spotlight-glow {
  opacity: 1;
}

/* 边框追光：用 mask 让边框只在鼠标附近显形 */
.s-spotlight-border {
  position: absolute;
  inset: 0;
  pointer-events: none;
  border-radius: inherit;
  padding: 1px;
  background: radial-gradient(
    var(--spotlight-size, 400px) circle at var(--mxp, 50%) var(--myp, 50%),
    rgb(var(--s-primary) / 0.6),
    transparent 70%
  );
  /* 用 mask 让背景只在 padding 区域可见（即边框） */
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask-composite: exclude;
  opacity: 0;
  transition: opacity 0.3s ease;
  z-index: 2;
}

.s-spotlight-card[data-hover="true"] .s-spotlight-border {
  opacity: 1;
}

/* 槽内容位于光斑之上 */
.s-spotlight-card > :deep(*:not(.s-spotlight-glow):not(.s-spotlight-border)) {
  position: relative;
  z-index: 3;
}

/* 暗色主题调整 */
html.dark .s-spotlight-card {
  box-shadow:
    0 6px 20px rgb(0 0 0 / 0.4),
    inset 0 1px 0 rgb(var(--s-on-surface) / 0.08);
}
</style>
