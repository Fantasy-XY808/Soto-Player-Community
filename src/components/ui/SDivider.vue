<script setup lang="ts">
withDefaults(
  defineProps<{
    /** 方向 */
    vertical?: boolean;
  }>(),
  { vertical: false },
);
</script>

<template>
  <div
    role="separator"
    class="bg-on-surface/10 transition-background-color duration-300"
    :class="vertical ? 'w-px h-4' : 'h-px'"
  />
</template>
