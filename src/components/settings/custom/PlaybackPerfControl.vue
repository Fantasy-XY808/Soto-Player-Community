<script setup lang="ts">
import type { MaxDspSampleRate } from "@shared/types/settings";
import { useSettingsStore } from "@/stores/settings";

defineOptions({ inheritAttrs: false });
defineProps<{ locked?: boolean }>();

const { t } = useI18n();
const settings = useSettingsStore();

const perf = computed(() => settings.system.player.playbackPerf);

const prefetchNextTrack = computed({
  get: () => perf.value?.prefetchNextTrack ?? true,
  set: (v: boolean) => settings.setSystem("player.playbackPerf.prefetchNextTrack", v),
});

const prefetchThresholdSec = computed({
  get: () => perf.value?.prefetchThresholdSec ?? 60,
  set: (v: number) => settings.setSystem("player.playbackPerf.prefetchThresholdSec", v),
});

const prefetchTtlSec = computed({
  get: () => perf.value?.prefetchTtlSec ?? 300,
  set: (v: number) => settings.setSystem("player.playbackPerf.prefetchTtlSec", v),
});

const maxDspSampleRate = computed<MaxDspSampleRate>({
  get: () => perf.value?.maxDspSampleRate ?? "192",
  set: (v: MaxDspSampleRate) => settings.setSystem("player.playbackPerf.maxDspSampleRate", v),
});

const sampleRateOptions: { value: MaxDspSampleRate; labelKey: string }[] = [
  { value: "96", labelKey: "settings.playbackPerf.maxDspSampleRate.options.96" },
  { value: "192", labelKey: "settings.playbackPerf.maxDspSampleRate.options.192" },
  { value: "384", labelKey: "settings.playbackPerf.maxDspSampleRate.options.384" },
];
</script>

<template>
  <div class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          <span>{{ t("settings.playbackPerf.label") }}</span>
          <STag type="info">Beta</STag>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.playbackPerf.description") }}
        </div>
      </div>
    </div>

    <div class="mt-4 flex flex-col gap-4">
      <div
        class="flex items-center justify-between gap-4 rounded-lg bg-surface-alt/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm">{{ t("settings.playbackPerf.prefetchNextTrack.label") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t("settings.playbackPerf.prefetchNextTrack.description") }}
          </div>
        </div>
        <SSwitch v-model="prefetchNextTrack" />
      </div>

      <div
        v-if="!locked"
        :class="[
          'flex flex-col gap-3',
          !prefetchNextTrack && 'opacity-50 pointer-events-none',
        ]"
      >
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.playbackPerf.prefetchThresholdSec.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ prefetchThresholdSec }} s
          </span>
        </div>
        <SSlider v-model="prefetchThresholdSec" :min="60" :max="180" :step="5" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.playbackPerf.prefetchTtlSec.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ prefetchTtlSec }} s
          </span>
        </div>
        <SSlider v-model="prefetchTtlSec" :min="60" :max="1800" :step="60" />
      </div>

      <div v-if="!locked" class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.playbackPerf.maxDspSampleRate.label") }}</span>
          <span class="text-xs text-on-surface-variant/60">
            {{ t("settings.playbackPerf.maxDspSampleRate.description") }}
          </span>
        </div>
        <div class="flex gap-2">
          <button
            v-for="opt in sampleRateOptions"
            :key="opt.value"
            type="button"
            :class="[
              'flex-1 rounded-lg border px-3 py-2 text-sm transition-colors',
              maxDspSampleRate === opt.value
                ? 'border-primary bg-primary-container/30 text-on-primary-container'
                : 'border-outline-variant/30 bg-surface-alt/20 text-on-surface-variant hover:bg-surface-alt/40',
            ]"
            @click="maxDspSampleRate = opt.value"
          >
            {{ t(opt.labelKey) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
