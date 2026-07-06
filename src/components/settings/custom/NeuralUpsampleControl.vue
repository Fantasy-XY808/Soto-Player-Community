<script setup lang="ts">
import type { NeuralUpsampleParams } from "@shared/types/settings";
import { useSettingsStore } from "@/stores/settings";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();

const nu = computed(() => settings.system.player.neuralUpsample);

const enabled = computed({
  get: () => nu.value?.enabled ?? false,
  set: (v: boolean) => settings.setSystem("player.neuralUpsample.enabled", v),
});

const bypass = computed({
  get: () => nu.value?.params?.bypass ?? false,
  set: (v: boolean) => updateParam("bypass", v),
});

const backend = computed({
  get: () => nu.value?.backend ?? 0,
  set: (v: number) => settings.setSystem("player.neuralUpsample.backend", v),
});

const modelPath = computed({
  get: () => nu.value?.modelPath ?? null,
  set: (v: string | null) => settings.setSystem("player.neuralUpsample.modelPath", v),
});

const params = computed<NeuralUpsampleParams>(
  () =>
    nu.value?.params ?? {
      inputGainDb: 0.0,
      wetMix: 0.5,
      bypass: false,
    },
);

const updateParam = <K extends keyof NeuralUpsampleParams>(
  key: K,
  value: NeuralUpsampleParams[K],
): void => {
  settings.setSystem("player.neuralUpsample.params", { ...params.value, [key]: value });
};

const backendOptions = [
  { value: 0, label: t("settings.neuralUpsampleBackend.fallback") },
  { value: 1, label: t("settings.neuralUpsampleBackend.onnx") },
];

// 实际生效后端：0=Fallback（直通），1=ONNX（模型加载成功后生效）
const effectiveBackend = ref<number>(0);
const modelLoaded = ref<boolean>(false);
const loadError = ref<string>("");

const refreshEffectiveBackend = async (): Promise<void> => {
  try {
    const resp = await window.api.player.getNeuralUpsampleEffectiveBackend();
    if (resp.success && resp.data != null) effectiveBackend.value = resp.data;
  } catch {
    // 引擎未就绪：保持 0
  }
};

const refreshModelPath = async (): Promise<void> => {
  try {
    const resp = await window.api.player.getNeuralModelPath();
    if (resp.success) {
      modelLoaded.value = resp.data != null && resp.data !== "";
    }
  } catch {
    // 引擎未就绪
  }
};

const pendingPath = ref<string>("");
watchEffect(() => {
  pendingPath.value = modelPath.value ?? "";
});

const onLoadModel = async (): Promise<void> => {
  const path = pendingPath.value.trim();
  if (!path) {
    loadError.value = t("settings.neuralUpsample.modelPath.empty");
    return;
  }
  loadError.value = "";
  try {
    const resp = await window.api.player.loadNeuralModel(path);
    if (resp.success) {
      modelPath.value = path;
      await refreshEffectiveBackend();
      await refreshModelPath();
    } else {
      loadError.value = resp.error ?? "load failed";
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e);
  }
};

const isDisabled = computed(() => !enabled.value || bypass.value);

onMounted(() => {
  void refreshEffectiveBackend();
  void refreshModelPath();
});
</script>

<template>
  <div class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4">
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 text-base">
          <span>{{ t("settings.neuralUpsample.label") }}</span>
          <STag type="info">Beta</STag>
        </div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("settings.neuralUpsample.description") }}
        </div>
      </div>
      <SSwitch v-model="enabled" />
    </div>

    <div v-if="enabled" class="mt-4 flex flex-col gap-4">
      <div
        class="flex items-center justify-between gap-4 rounded-lg bg-surface-container/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm">{{ t("settings.neuralUpsample.bypass.label") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t("settings.neuralUpsample.bypass.description") }}
          </div>
        </div>
        <SSwitch v-model="bypass" />
      </div>

      <div
        class="flex items-center justify-between gap-4 rounded-lg bg-surface-container/40 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm">{{ t("settings.neuralUpsample.backend.label") }}</div>
          <div class="text-xs text-on-surface-variant/60 mt-0.5">
            {{ t("settings.neuralUpsample.backend.description") }}
          </div>
        </div>
        <SSelect v-model="backend" :options="backendOptions" class="w-40" />
      </div>

      <div class="flex flex-col gap-2 rounded-lg bg-surface-container/40 px-4 py-3">
        <div class="text-sm">{{ t("settings.neuralUpsample.modelPath.label") }}</div>
        <div class="text-xs text-on-surface-variant/60 mt-0.5">
          {{ t("settings.neuralUpsample.modelPath.description") }}
        </div>
        <div class="mt-2 flex gap-2">
          <input
            v-model="pendingPath"
            type="text"
            :placeholder="t('settings.neuralUpsample.modelPath.placeholder')"
            class="min-w-0 flex-1 rounded-md border border-solid border-outline-variant/30 bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
          />
          <SButton size="small" @click="onLoadModel">
            {{ t("settings.neuralUpsample.modelPath.load") }}
          </SButton>
        </div>
        <div v-if="loadError" class="text-xs text-error/80 mt-1">{{ loadError }}</div>
        <div class="text-xs text-on-surface-variant/60 mt-1">
          <span v-if="modelLoaded">
            {{ t("settings.neuralUpsample.modelPath.loaded") }}
          </span>
          <span v-else>
            {{ t("settings.neuralUpsample.modelPath.notLoaded") }}
          </span>
        </div>
      </div>

      <div :class="['flex flex-col gap-3', isDisabled && 'opacity-50 pointer-events-none']">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.neuralUpsample.inputGainDb.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ params.inputGainDb.toFixed(1) }} dB
          </span>
        </div>
        <SSlider
          :model-value="params.inputGainDb"
          :min="-12"
          :max="12"
          :step="0.5"
          @update:model-value="updateParam('inputGainDb', $event)"
        />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm">{{ t("settings.neuralUpsample.wetMix.label") }}</span>
          <span class="text-xs text-on-surface-variant tabular-nums">
            {{ params.wetMix.toFixed(2) }}
          </span>
        </div>
        <SSlider
          :model-value="params.wetMix"
          :min="0"
          :max="1.0"
          :step="0.01"
          @update:model-value="updateParam('wetMix', $event)"
        />
      </div>
    </div>
  </div>
</template>
