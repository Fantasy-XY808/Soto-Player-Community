<script setup lang="ts">
/**
 * 路由加载进度条
 *
 * 监听 router.beforeResolve 派发的 route-loading-start / route-loading-end 事件，
 * 在顶部显示一条进度条，让用户知道"在加载"而非"卡死"。
 *
 * 设计：
 * - 50ms 防抖：避免快速切换（已缓存页面）时进度条闪烁
 * - 顶部固定 2px 渐变条，避免遮挡内容
 * - 加载中显示 indeterminate 动画，加载完成淡出
 * - z-index 极高（z-9999），确保在所有内容之上
 */
import { onMounted, onBeforeUnmount, ref } from "vue";

const loading = ref(false);
let endTimer: ReturnType<typeof setTimeout> | null = null;

const onStart = (): void => {
  if (endTimer) {
    clearTimeout(endTimer);
    endTimer = null;
  }
  loading.value = true;
};

const onEnd = (): void => {
  // 延迟 150ms 隐藏，让进度条动画完成
  endTimer = setTimeout(() => {
    loading.value = false;
  }, 150);
};

onMounted(() => {
  window.addEventListener("route-loading-start", onStart);
  window.addEventListener("route-loading-end", onEnd);
});

onBeforeUnmount(() => {
  window.removeEventListener("route-loading-start", onStart);
  window.removeEventListener("route-loading-end", onEnd);
  if (endTimer) clearTimeout(endTimer);
});
</script>

<template>
  <Transition name="route-loading-fade">
    <div v-if="loading" class="route-loading-bar" aria-hidden="true">
      <div class="route-loading-progress" />
    </div>
  </Transition>
</template>

<style scoped>
.route-loading-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  z-index: 9999;
  pointer-events: none;
  background: rgba(var(--s-primary-rgb, 99 102 241), 0.15);
  overflow: hidden;
}

.route-loading-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  width: 40%;
  background: var(--s-primary, rgb(99 102 241));
  border-radius: 0 2px 2px 0;
  box-shadow: 0 0 8px rgba(var(--s-primary-rgb, 99 102 241), 0.6);
  animation: route-loading-slide 1.2s ease-in-out infinite;
}

@keyframes route-loading-slide {
  0% {
    transform: translateX(-100%);
    width: 40%;
  }
  50% {
    transform: translateX(150%);
    width: 60%;
  }
  100% {
    transform: translateX(300%);
    width: 40%;
  }
}

.route-loading-fade-enter-active,
.route-loading-fade-leave-active {
  transition: opacity 0.2s ease;
}

.route-loading-fade-enter-from,
.route-loading-fade-leave-to {
  opacity: 0;
}
</style>
