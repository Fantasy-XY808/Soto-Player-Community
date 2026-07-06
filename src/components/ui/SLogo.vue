<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 30 });
</script>

<template>
  <img
    src="/icons/logo-icon.png"
    alt="logo"
    class="shrink-0 object-contain"
    :style="{ height: `${size}px`, width: `${size}px` }"
  />
</template>
