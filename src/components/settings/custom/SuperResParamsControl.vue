<script setup lang="ts">
import type { SuperResParams } from "@shared/types/settings";
import { useSettingsStore } from "@/stores/settings";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();

const sr = computed(() => settings.system.player.audioSuperResolution);

const enabled = computed({
  get: () => sr.value?.enabled ?? false,
  set: (v: boolean) => settings.setSystem("player.audioSuperResolution.enabled", v),
});

const bypass = computed({
  get: () => sr.value?.params?.bypass ?? false,
  set: (v: boolean) => updateParam("bypass", v),
});

const backend = computed({
  get: () => sr.value?.backend ?? 0,
  set: (v: number) => settings.setSystem("player.audioSuperResolution.backend", v),
});

const params = computed<SuperResParams>(
  () =>
    sr.value?.params ?? {
      hpFreq: 4500,
      hpQ: 0.7,
      drive: 3.0,
      h2Drive: 0.6,
      h2Mix: 0.08,
      wetMix: 0.4,
      inputLimit: 1.2,
      bypass: false,
    },
);

const updateParam = <K extends keyof SuperResParams>(key: K, value: SuperResParams[K]): void => {
  settings.setSystem("player.audioSuperResolution.params", { ...params.value, [key]: value });
};

const backendOptions = [
  { value: 0, label: t("settings.audioSuperResolutionBackend.cpu") },
  { value: 1, label: t("settings.audioSuperResolutionBackend.gpu") },
  { value: 2, label: t("settings.audioSuperResolutionBackend.npu") },
];

const isDisabled = computed(() => !enabled.value || bypass.value);
</script>

<template>
  <div class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          <span>{{ t("settings.audioSuperResolutionEnabled.label") }}</span>
          <STag type="info">Beta</STag>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.audioSuperResolutionEnabled.description") }}
        </div>
      </div>
      <SSwitch v-model="enabled" />
    </div>

    <div v-if="enabled" class="mt-4 flex flex-col gap-4">
      <div
        class="flex items-center justify-between gap-4 rounded-lg bg-surface-container/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm">{{ t("settings.audioSuperResolutionParams.bypass.label") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t("settings.audioSuperResolutionParams.bypass.description") }}
          </div>
        </div>
        <SSwitch v-model="bypass" />
      </div>

      <div
        class="flex items-center justify-between gap-4 rounded-lg bg-surface-container/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm">{{ t("settings.audioSuperResolutionBackend.label") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t("settings.audioSuperResolutionBackend.description") }}
          </div>
        </div>
        <SSelect v-model="backend" :options="backendOptions" class="w-40" />
      </div>

      <div :class="['flex flex-col gap-3', isDisabled && 'opacity-50 pointer-events-none']">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.audioSuperResolutionParams.hpFreq.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ params.hpFreq.toFixed(0) }} Hz
          </span>
        </div>
        <SSlider
          :model-value="params.hpFreq"
          :min="2000"
          :max="8000"
          :step="100"
          @update:model-value="updateParam('hpFreq', $event)"
        />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.audioSuperResolutionParams.hpQ.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ params.hpQ.toFixed(2) }}
          </span>
        </div>
        <SSlider
          :model-value="params.hpQ"
          :min="0.1"
          :max="2.0"
          :step="0.05"
          @update:model-value="updateParam('hpQ', $event)"
        />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.audioSuperResolutionParams.drive.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ params.drive.toFixed(2) }}
          </span>
        </div>
        <SSlider
          :model-value="params.drive"
          :min="0.5"
          :max="6.0"
          :step="0.1"
          @update:model-value="updateParam('drive', $event)"
        />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.audioSuperResolutionParams.h2Drive.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ params.h2Drive.toFixed(2) }}
          </span>
        </div>
        <SSlider
          :model-value="params.h2Drive"
          :min="0"
          :max="1.5"
          :step="0.05"
          @update:model-value="updateParam('h2Drive', $event)"
        />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.audioSuperResolutionParams.h2Mix.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ params.h2Mix.toFixed(3) }}
          </span>
        </div>
        <SSlider
          :model-value="params.h2Mix"
          :min="0"
          :max="0.5"
          :step="0.005"
          @update:model-value="updateParam('h2Mix', $event)"
        />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.audioSuperResolutionParams.wetMix.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ params.wetMix.toFixed(3) }}
          </span>
        </div>
        <SSlider
          :model-value="params.wetMix"
          :min="0"
          :max="1.0"
          :step="0.01"
          @update:model-value="updateParam('wetMix', $event)"
        />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">
            {{ t("settings.audioSuperResolutionParams.inputLimit.label") }}
          </span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ params.inputLimit.toFixed(2) }}
          </span>
        </div>
        <SSlider
          :model-value="params.inputLimit"
          :min="0.5"
          :max="2.0"
          :step="0.05"
          @update:model-value="updateParam('inputLimit', $event)"
        />
      </div>
    </div>
  </div>
</template>
