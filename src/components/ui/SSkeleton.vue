<script setup lang="ts">
interface SSkeletonProps {
  /** 形状：rect 矩形（默认）/ circle 圆 / lines 多行文本 */
  type?: "rect" | "circle" | "lines";
  /** 行数（仅 type=lines） */
  lines?: number;
}

withDefaults(defineProps<SSkeletonProps>(), {
  type: "rect",
  lines: 3,
});
</script>

<template>
  <!-- 多行文本骨架：最后一行 2/3 宽度，模拟自然段尾 -->
  <div v-if="type === 'lines'" class="flex w-full flex-col gap-2">
    <div
      v-for="i in lines"
      :key="i"
      class="h-3 rounded bg-on-surface/10 animate-pulse"
      :class="i === lines ? 'w-2/3' : 'w-full'"
    />
  </div>
  <!-- 矩形/圆形：宽高由调用方通过 class 控制，默认铺满父容器 -->
  <div
    v-else
    class="size-full bg-on-surface/10 animate-pulse"
    :class="type === 'circle' ? 'rounded-full' : 'rounded-md'"
  />
</template>
