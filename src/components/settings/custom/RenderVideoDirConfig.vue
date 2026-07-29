<script setup lang="ts">
/**
 * 视频渲染输出目录配置卡片
 *
 * 复用 download 模块的 pickDir/getDir/setDir IPC（实际上调用 renderVideo 自己的 IPC），
 * 由主进程的 renderVideoManager 持久化到 store.renderVideo.dir。
 */
import IconLucideFolderOpen from "~icons/lucide/folder-open";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();

const dir = ref("");

const load = async (): Promise<void> => {
  dir.value = await window.api.renderVideo.getDir();
};

const change = async (): Promise<void> => {
  const result = await window.api.renderVideo.pickDir();
  if (result.ok) dir.value = result.dir;
};

const openDir = (): void => {
  if (dir.value) void window.api.system.showInExplorer(dir.value);
};

onMounted(load);
</script>

<template>
  <div
    class="flex items-center justify-between gap-4 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel px-4 py-3.5"
  >
    <div class="min-w-0 flex-1">
      <div class="text-base">{{ t("settings.renderVideoDir.label") }}</div>
      <div class="mt-0.5 truncate font-mono text-sm text-on-surface-variant/70" :title="dir">
        {{ dir || "—" }}
      </div>
    </div>
    <div class="shrink-0 flex items-center gap-2">
      <SButton variant="ghost" circle :title="t('settings.cacheDir.open')" @click="openDir">
        <template #icon><IconLucideFolderOpen /></template>
      </SButton>
      <SButton variant="secondary" @click="change">
        {{ t("settings.downloadDir.change") }}
      </SButton>
    </div>
  </div>
</template>
