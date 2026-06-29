<script setup lang="ts">
defineProps<{
  collapsed: boolean;
}>();

const router = useRouter();

const goHome = (): void => {
  router.push("/");
};
</script>

<template>
  <div class="flex items-center justify-center h-16 shrink-0 px-4">
    <div
      role="link"
      tabindex="0"
      class="inline-flex items-center cursor-pointer transform-gpu transition-transform duration-300 hover:scale-105 active:scale-100"
      @click="goHome"
    >
      <SLogo :size="30" class="shrink-0" />
      <div
        class="flex flex-col overflow-hidden transition-[width,opacity,margin] duration-300"
        :class="collapsed ? 'w-0 opacity-0 ml-0' : 'w-[150px] ml-2'"
      >
        <span class="text-[22px] text-primary mt-0.5 leading-7 whitespace-nowrap font-logo">
          Soto Player
        </span>
        <span
          class="text-[10px] text-on-surface-variant/70 leading-3 whitespace-nowrap font-medium tracking-wider pl-0.5"
        >
          Community
        </span>
      </div>
    </div>
  </div>
</template>
