<script setup lang="ts">
import { computed, onMounted } from "vue";
import { usePluginsStore } from "@/stores/plugins";
import { isQishuiAvailable } from "@/apis/qishui";
import IconLucideInfo from "~icons/lucide/info";
import IconLucidePuzzle from "~icons/lucide/puzzle";
import IconLucideCheckCircle2 from "~icons/lucide/check-circle-2";

const { t } = useI18n();
const plugins = usePluginsStore();

/** 汽水音乐插件是否已安装并就绪 */
const available = computed(() => isQishuiAvailable());

onMounted(() => {
  if (!plugins.loaded) plugins.load().catch(() => undefined);
});

/** 跳转到插件设置页 */
const openPluginsSettings = (): void => {
  window.api.system.openSettings("plugins").catch(() => undefined);
};
</script>

<template>
  <div
    class="flex items-start gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
  >
    <div class="shrink-0 size-10 rounded-full bg-on-surface/6 flex items-center justify-center">
      <IconLucideInfo class="size-5 text-on-surface-variant" />
    </div>
    <div class="min-w-0 flex-1">
      <div class="text-sm font-medium text-on-surface">{{ t("account.qishui.title") }}</div>
      <div class="text-xs text-on-surface-variant/70 mt-0.5">
        {{ t("account.qishui.description") }}
      </div>
      <div v-if="available" class="flex items-center gap-1.5 mt-1.5 text-xs text-emerald-500">
        <IconLucideCheckCircle2 class="size-3.5" />
        <span>{{ t("account.qishui.installed") }}</span>
      </div>
    </div>
    <SButton variant="secondary" size="small" @click="openPluginsSettings">
      <template #icon><IconLucidePuzzle class="size-4" /></template>
      {{ t("account.qishui.openPlugins") }}
    </SButton>
  </div>
</template>
