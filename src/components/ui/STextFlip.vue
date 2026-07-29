<script setup lang="ts">
/**
 * STextFlip 文字翻转切换
 *
 * 移植自 Inspira UI 的 text-flip 设计：
 * - 当 text 变化时，旧字符向上翻出，新字符从下方翻入
 * - 每个字符独立翻转，整体呈现"老虎机"式切换效果
 * - 适合标题、状态文字、当前歌曲名等动态切换场景
 *
 * 实现：纯 CSS 3D transform + Vue TransitionGroup，
 * 不依赖 motion-v。
 *
 * 用法：
 *   <STextFlip :text="currentTitle" />
 */

interface Props {
  /** 显示的文字 */
  text: string;
  /** 单字符翻转时长（ms） */
  duration?: number;
  /** 字符间错峰延迟（ms） */
  stagger?: number;
  /** 字体大小（px，影响翻转半径） */
  fontSize?: number;
  /** 容器自定义类 */
  containerClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  duration: 400,
  stagger: 30,
  fontSize: 16,
  containerClass: "",
});

/** 拆分文本为字符数组（保留空格） */
const chars = computed(() => Array.from(props.text));

/** 唯一 key 用于 TransitionGroup：text + 索引，让 Vue 识别新字符 */
const charKey = (ch: string, idx: number): string => `${ch}-${idx}-${props.text.length}`;

const containerStyle = computed(() => ({
  fontSize: `${props.fontSize}px`,
  // 透视距离根据字号自适应
  perspective: `${props.fontSize * 4}px`,
}));
</script>

<template>
  <span class="s-text-flip" :class="containerClass" :style="containerStyle">
    <TransitionGroup name="flip" tag="span" class="s-text-flip-inner">
      <span
        v-for="(ch, idx) in chars"
        :key="charKey(ch, idx)"
        class="s-text-flip-char"
        :style="{
          animationDuration: `${duration}ms`,
          animationDelay: `${idx * stagger}ms`,
        }"
      >
        {{ ch === " " ? "\u00A0" : ch }}
      </span>
    </TransitionGroup>
  </span>
</template>

<style scoped>
.s-text-flip {
  display: inline-flex;
  perspective: 60px;
}

.s-text-flip-inner {
  display: inline-flex;
  white-space: nowrap;
}

.s-text-flip-char {
  display: inline-block;
  transform-style: preserve-3d;
  backface-visibility: hidden;
  will-change: transform, opacity;
}

/* 翻转入场：从下方旋转 + 透明 → 中位 */
.flip-enter-active {
  animation: flip-in var(--duration, 400ms) cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

/* 翻转出场：中位 → 向上旋转 + 透明 */
.flip-leave-active {
  position: absolute;
  animation: flip-out var(--duration, 400ms) cubic-bezier(0.55, 0.05, 0.45, 0.95) both;
}

@keyframes flip-in {
  0% {
    transform: rotateX(-90deg) translateY(0.6em);
    opacity: 0;
  }
  100% {
    transform: rotateX(0deg) translateY(0);
    opacity: 1;
  }
}

@keyframes flip-out {
  0% {
    transform: rotateX(0deg) translateY(0);
    opacity: 1;
  }
  100% {
    transform: rotateX(90deg) translateY(-0.6em);
    opacity: 0;
  }
}

/* 尊重用户的减少动画偏好 */
@media (prefers-reduced-motion: reduce) {
  .flip-enter-active,
  .flip-leave-active {
    animation: none;
  }
  .flip-enter-from {
    opacity: 0;
  }
  .flip-leave-to {
    opacity: 0;
  }
}
</style>
