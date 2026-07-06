<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/settings";
import type { SongUnlockServerConfig, SongUnlockServerKey } from "@shared/types/settings";

const { t } = useI18n();
const settings = useSettingsStore();

/** 当前解灰源配置（响应式） */
const servers = computed<SongUnlockServerConfig[]>(() => settings.system.system.songUnlockServer);

/** 各源展示信息 */
const labels: Record<SongUnlockServerKey, { name: string; desc: string }> = {
  netease: {
    name: t("settings.songUnlockServer.netease.name"),
    desc: t("settings.songUnlockServer.netease.desc"),
  },
  kuwo: {
    name: t("settings.songUnlockServer.kuwo.name"),
    desc: t("settings.songUnlockServer.kuwo.desc"),
  },
  bodian: {
    name: t("settings.songUnlockServer.bodian.name"),
    desc: t("settings.songUnlockServer.bodian.desc"),
  },
};

/**
 * 切换某个源的启用状态；整体数组下发，主进程整盘替换
 * @param key - 源标识
 * @param enabled - 是否启用
 */
const toggle = (key: SongUnlockServerKey, enabled: boolean): void => {
  const next = servers.value.map((s) => (s.key === key ? { ...s, enabled } : s));
  void settings.setSystem("system.songUnlockServer", next);
};
</script>

<template>
  <div class="flex flex-col gap-3 py-1">
    <div
      v-for="server in servers"
      :key="server.key"
      class="flex items-start justify-between gap-4 rounded-lg border border-outline-variant/40 px-4 py-3"
    >
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-on-surface">{{ labels[server.key].name }}</div>
        <div class="mt-0.5 text-xs text-on-surface-variant/70">
          {{ labels[server.key].desc }}
        </div>
      </div>
      <SSwitch
        :model-value="server.enabled"
        @update:model-value="(v: boolean) => toggle(server.key, v)"
      />
    </div>
  </div>
</template>
