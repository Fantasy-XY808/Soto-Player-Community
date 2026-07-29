<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";

defineOptions({ inheritAttrs: false });
defineProps<{ locked?: boolean }>();

const { t } = useI18n();
const settings = useSettingsStore();

const tpl = computed(() => settings.system.player.truePeakLimiter);

const enabled = computed({
  get: () => tpl.value?.enabled ?? false,
  set: (v: boolean) => settings.setSystem("player.truePeakLimiter.enabled", v),
});

const bypass = computed({
  get: () => tpl.value?.bypass ?? false,
  set: (v: boolean) => settings.setSystem("player.truePeakLimiter.bypass", v),
});

const thresholdDbtp = computed({
  get: () => tpl.value?.thresholdDbtp ?? -1.0,
  set: (v: number) => settings.setSystem("player.truePeakLimiter.thresholdDbtp", v),
});

const ceilingDbtp = computed({
  get: () => tpl.value?.ceilingDbtp ?? -0.5,
  set: (v: number) => settings.setSystem("player.truePeakLimiter.ceilingDbtp", v),
});

const attackMs = computed({
  get: () => tpl.value?.attackMs ?? 5.0,
  set: (v: number) => settings.setSystem("player.truePeakLimiter.attackMs", v),
});

const releaseMs = computed({
  get: () => tpl.value?.releaseMs ?? 100.0,
  set: (v: number) => settings.setSystem("player.truePeakLimiter.releaseMs", v),
});

const isDisabled = computed(() => !enabled.value || bypass.value);
</script>

<template>
  <div class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          <span>{{ t("settings.truePeakLimiter.label") }}</span>
          <STag type="info">Beta</STag>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.truePeakLimiter.description") }}
        </div>
      </div>
      <SSwitch v-model="enabled" />
    </div>

    <div v-if="enabled" class="mt-4 flex flex-col gap-4">
      <div
        class="flex items-center justify-between gap-4 rounded-lg bg-surface-alt/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm">{{ t("settings.truePeakLimiter.bypass.label") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t("settings.truePeakLimiter.bypass.description") }}
          </div>
        </div>
        <SSwitch v-model="bypass" />
      </div>

      <div
        v-if="!locked"
        :class="['flex flex-col gap-3', isDisabled && 'opacity-50 pointer-events-none']"
      >
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.truePeakLimiter.thresholdDbtp.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ thresholdDbtp.toFixed(1) }} dBTP
          </span>
        </div>
        <SSlider v-model="thresholdDbtp" :min="-9" :max="0" :step="0.1" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.truePeakLimiter.ceilingDbtp.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ ceilingDbtp.toFixed(1) }} dBTP
          </span>
        </div>
        <SSlider v-model="ceilingDbtp" :min="-6" :max="0" :step="0.1" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.truePeakLimiter.attackMs.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ attackMs.toFixed(1) }} ms
          </span>
        </div>
        <SSlider v-model="attackMs" :min="0.5" :max="50" :step="0.5" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.truePeakLimiter.releaseMs.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ releaseMs.toFixed(1) }} ms
          </span>
        </div>
        <SSlider v-model="releaseMs" :min="10" :max="1000" :step="10" />
      </div>
    </div>
  </div>
</template>
