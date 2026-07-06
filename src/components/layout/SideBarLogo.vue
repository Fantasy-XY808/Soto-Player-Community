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
        class="flex flex-col overflow-hidden transition-[max-width,opacity,margin] duration-300"
        :class="collapsed ? 'max-w-0 opacity-0 ml-0' : 'max-w-[180px] opacity-100 ml-2'"
      >
        <span class="text-[16px] text-primary leading-5 whitespace-nowrap font-logo font-semibold">
          Soto Player
        </span>
        <span
          class="text-[11px] text-on-surface-variant/60 ml-1 leading-4 whitespace-nowrap font-logo font-light"
        >
          Community
        </span>
      </div>
    </div>
  </div>
</template>
