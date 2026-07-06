<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();

const sa = computed(() => settings.system.player.spatialAudio);

const enabled = computed({
  get: () => sa.value?.enabled ?? false,
  set: (v: boolean) => settings.setSystem("player.spatialAudio.enabled", v),
});

const bypass = computed({
  get: () => sa.value?.bypass ?? false,
  set: (v: boolean) => settings.setSystem("player.spatialAudio.bypass", v),
});

const width = computed({
  get: () => sa.value?.width ?? 1.4,
  set: (v: number) => settings.setSystem("player.spatialAudio.width", v),
});

const bassGainDb = computed({
  get: () => sa.value?.bassGainDb ?? 4.0,
  set: (v: number) => settings.setSystem("player.spatialAudio.bassGainDb", v),
});

const bassFreq = computed({
  get: () => sa.value?.bassFreq ?? 80,
  set: (v: number) => settings.setSystem("player.spatialAudio.bassFreq", v),
});

const superResDrive = computed({
  get: () => sa.value?.superResDrive ?? 4.5,
  set: (v: number) => settings.setSystem("player.spatialAudio.superResDrive", v),
});

const superResWetMix = computed({
  get: () => sa.value?.superResWetMix ?? 0.55,
  set: (v: number) => settings.setSystem("player.spatialAudio.superResWetMix", v),
});

const isDisabled = computed(() => !enabled.value || bypass.value);
</script>

<template>
  <div class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          <span>{{ t("settings.spatialAudio.label") }}</span>
          <STag type="cover">Beta</STag>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.spatialAudio.description") }}
        </div>
      </div>
      <SSwitch v-model="enabled" />
    </div>

    <div v-if="enabled" class="mt-4 flex flex-col gap-4">
      <div
        class="flex items-center justify-between gap-4 rounded-lg bg-surface-container/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm">{{ t("settings.spatialAudio.bypass.label") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t("settings.spatialAudio.bypass.description") }}
          </div>
        </div>
        <SSwitch v-model="bypass" />
      </div>

      <div :class="['flex flex-col gap-3', isDisabled && 'opacity-50 pointer-events-none']">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.spatialAudio.width.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">{{ width.toFixed(2) }}</span>
        </div>
        <SSlider
          v-model="width"
          :min="1.0"
          :max="2.0"
          :step="0.05"
          :marks="{ 1: '1.0', 1.5: '1.5', 2: '2.0' }"
        />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.spatialAudio.bassGainDb.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ bassGainDb.toFixed(1) }} dB
          </span>
        </div>
        <SSlider v-model="bassGainDb" :min="0" :max="12" :step="0.5" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.spatialAudio.bassFreq.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ bassFreq.toFixed(0) }} Hz
          </span>
        </div>
        <SSlider v-model="bassFreq" :min="40" :max="200" :step="5" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.spatialAudio.superResDrive.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ superResDrive.toFixed(2) }}
          </span>
        </div>
        <SSlider v-model="superResDrive" :min="1.0" :max="6.0" :step="0.1" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.spatialAudio.superResWetMix.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ superResWetMix.toFixed(3) }}
          </span>
        </div>
        <SSlider v-model="superResWetMix" :min="0" :max="1.0" :step="0.01" />
      </div>
    </div>
  </div>
</template>
