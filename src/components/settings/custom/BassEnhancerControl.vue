<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();

const be = computed(() => settings.system.player.bassEnhancer);

const enabled = computed({
  get: () => be.value?.enabled ?? false,
  set: (v: boolean) => settings.setSystem("player.bassEnhancer.enabled", v),
});

const bypass = computed({
  get: () => be.value?.bypass ?? false,
  set: (v: boolean) => settings.setSystem("player.bassEnhancer.bypass", v),
});

const freq = computed({
  get: () => be.value?.freq ?? 100,
  set: (v: number) => settings.setSystem("player.bassEnhancer.freq", v),
});

const gainDb = computed({
  get: () => be.value?.gainDb ?? 6.0,
  set: (v: number) => settings.setSystem("player.bassEnhancer.gainDb", v),
});

const q = computed({
  get: () => be.value?.q ?? 0.7,
  set: (v: number) => settings.setSystem("player.bassEnhancer.q", v),
});

const isDisabled = computed(() => !enabled.value || bypass.value);
</script>

<template>
  <div class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          <span>{{ t("settings.bassEnhancer.label") }}</span>
          <STag type="info">Beta</STag>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.bassEnhancer.description") }}
        </div>
      </div>
      <SSwitch v-model="enabled" />
    </div>

    <div v-if="enabled" class="mt-4 flex flex-col gap-4">
      <div
        class="flex items-center justify-between gap-4 rounded-lg bg-surface-container/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm">{{ t("settings.bassEnhancer.bypass.label") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t("settings.bassEnhancer.bypass.description") }}
          </div>
        </div>
        <SSwitch v-model="bypass" />
      </div>

      <div :class="['flex flex-col gap-3', isDisabled && 'opacity-50 pointer-events-none']">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.bassEnhancer.freq.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">{{ freq.toFixed(0) }} Hz</span>
        </div>
        <SSlider v-model="freq" :min="20" :max="500" :step="5" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.bassEnhancer.gainDb.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ gainDb.toFixed(1) }} dB
          </span>
        </div>
        <SSlider v-model="gainDb" :min="0" :max="15" :step="0.5" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.bassEnhancer.q.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">{{ q.toFixed(2) }}</span>
        </div>
        <SSlider v-model="q" :min="0.1" :max="2.0" :step="0.05" />
      </div>
    </div>
  </div>
</template>
