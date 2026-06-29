<script setup lang="ts">
export interface SMarqueeProps {
  /** 滚动速度（px/s） */
  speed?: number;
  /** 开始滚动前的延迟（ms） */
  delay?: number;
  /** 两段文本之间的间距（px） */
  gap?: number;
  /** 收缩适应内容 */
  fit?: boolean;
}

const props = withDefaults(defineProps<SMarqueeProps>(), {
  speed: 30,
  delay: 2000,
  gap: 50,
  fit: false,
});

const containerRef = ref<HTMLElement>();
const textRef = ref<HTMLElement>();
const isOverflowing = ref(false);
const animDuration = ref("0s");

let resizeObserver: ResizeObserver | null = null;

const check = () => {
  const container = containerRef.value;
  const text = textRef.value;
  if (!container || !text) return;
  const overflow = text.scrollWidth > container.clientWidth;
  isOverflowing.value = overflow;
  if (overflow) {
    animDuration.value = `${text.scrollWidth / props.speed}s`;
  }
};

onMounted(() => {
  resizeObserver = new ResizeObserver(check);
  if (containerRef.value) resizeObserver.observe(containerRef.value);
  if (textRef.value) resizeObserver.observe(textRef.value);
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <div ref="containerRef" class="overflow-hidden" :class="fit ? 'max-w-full' : 'w-full'">
    <div
      class="inline-flex whitespace-nowrap min-w-full will-change-transform"
      :class="isOverflowing && 's-marquee-scrolling'"
      :style="{
        '--marquee-duration': animDuration,
        '--marquee-delay': `${delay}ms`,
        '--marquee-gap': `${gap}px`,
      }"
    >
      <span ref="textRef" class="inline-flex items-center whitespace-nowrap shrink-0">
        <slot />
      </span>
      <span
        v-if="isOverflowing"
        class="inline-flex items-center whitespace-nowrap shrink-0 pl-[var(--marquee-gap,50px)]"
        aria-hidden="true"
      >
        <slot />
      </span>
    </div>
  </div>
</template>

<style>
/* 动画属性依赖运行时 CSS 变量（duration/delay/gap），@keyframes 内部又有 calc(var(...))
   组合后既无法直接用 UnoCSS 的 animate-* 工具类，把变量写进 uno.config.ts 又会污染全局配置
   保留这一段 <style>，作为组件局部动画定义 */
.s-marquee-scrolling {
  animation: s-marquee-scroll var(--marquee-duration, 10s) linear var(--marquee-delay, 2s) infinite;
}
@keyframes s-marquee-scroll {
  0% {
    transform: translateX(0);
  }
  100% {
    transform: translateX(calc(-50% - var(--marquee-gap, 50px) / 2));
  }
}
</style>
