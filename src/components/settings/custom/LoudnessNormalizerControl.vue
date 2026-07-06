<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();

const ln = computed(() => settings.system.player.loudnessNormalizer);

const enabled = computed({
  get: () => ln.value?.enabled ?? false,
  set: (v: boolean) => settings.setSystem("player.loudnessNormalizer.enabled", v),
});

const bypass = computed({
  get: () => ln.value?.bypass ?? false,
  set: (v: boolean) => settings.setSystem("player.loudnessNormalizer.bypass", v),
});

const targetLufs = computed({
  get: () => ln.value?.targetLufs ?? -14.0,
  set: (v: number) => settings.setSystem("player.loudnessNormalizer.targetLufs", v),
});

const maxGainDb = computed({
  get: () => ln.value?.maxGainDb ?? 6.0,
  set: (v: number) => settings.setSystem("player.loudnessNormalizer.maxGainDb", v),
});

const isDisabled = computed(() => !enabled.value || bypass.value);
</script>

<template>
  <div class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          <span>{{ t("settings.loudnessNormalizer.label") }}</span>
          <STag type="info">Beta</STag>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.loudnessNormalizer.description") }}
        </div>
      </div>
      <SSwitch v-model="enabled" />
    </div>

    <div v-if="enabled" class="mt-4 flex flex-col gap-4">
      <div
        class="flex items-center justify-between gap-4 rounded-lg bg-surface-container/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm">{{ t("settings.loudnessNormalizer.bypass.label") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t("settings.loudnessNormalizer.bypass.description") }}
          </div>
        </div>
        <SSwitch v-model="bypass" />
      </div>

      <div :class="['flex flex-col gap-3', isDisabled && 'opacity-50 pointer-events-none']">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.loudnessNormalizer.targetLufs.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ targetLufs.toFixed(1) }} LUFS
          </span>
        </div>
        <SSlider v-model="targetLufs" :min="-30" :max="0" :step="0.5" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.loudnessNormalizer.maxGainDb.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ maxGainDb.toFixed(1) }} dB
          </span>
        </div>
        <SSlider v-model="maxGainDb" :min="0" :max="12" :step="0.5" />
      </div>
    </div>
  </div>
</template>
