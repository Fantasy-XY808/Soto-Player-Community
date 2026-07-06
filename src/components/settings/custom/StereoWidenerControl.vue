<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();

const sw = computed(() => settings.system.player.stereoWidener);

const enabled = computed({
  get: () => sw.value?.enabled ?? false,
  set: (v: boolean) => settings.setSystem("player.stereoWidener.enabled", v),
});

const bypass = computed({
  get: () => sw.value?.bypass ?? false,
  set: (v: boolean) => settings.setSystem("player.stereoWidener.bypass", v),
});

const width = computed({
  get: () => sw.value?.width ?? 1.0,
  set: (v: number) => settings.setSystem("player.stereoWidener.width", v),
});

const isDisabled = computed(() => !enabled.value || bypass.value);
</script>

<template>
  <div class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          <span>{{ t("settings.stereoWidener.label") }}</span>
          <STag type="info">Beta</STag>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.stereoWidener.description") }}
        </div>
      </div>
      <SSwitch v-model="enabled" />
    </div>

    <div v-if="enabled" class="mt-4 flex flex-col gap-4">
      <div
        class="flex items-center justify-between gap-4 rounded-lg bg-surface-container/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm">{{ t("settings.stereoWidener.bypass.label") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t("settings.stereoWidener.bypass.description") }}
          </div>
        </div>
        <SSwitch v-model="bypass" />
      </div>

      <div :class="['flex flex-col gap-3', isDisabled && 'opacity-50 pointer-events-none']">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.stereoWidener.width.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">{{ width.toFixed(2) }}</span>
        </div>
        <SSlider
          v-model="width"
          :min="0"
          :max="2.0"
          :step="0.05"
          :marks="{ 0: '0', 1: '1.0', 2: '2.0' }"
        />
      </div>
    </div>
  </div>
</template>
