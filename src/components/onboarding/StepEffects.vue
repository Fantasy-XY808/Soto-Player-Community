<script setup lang="ts">
import { useSettingsStore } from "@/stores/settings";
import IconSparkles from "~icons/lucide/sparkles";
import IconGauge from "~icons/lucide/gauge";
import IconChevronLeft from "~icons/lucide/chevron-left";
import IconArrowRight from "~icons/lucide/arrow-right";
import IconCheck from "~icons/lucide/check";

const { t } = useI18n();
const emit = defineEmits<{ (e: "next"): void; (e: "back"): void }>();
const settings = useSettingsStore();

/** 特效项绑定的 settings.player 字段（仅 boolean 开关） */
type BooleanEffectPath =
  | "enableFluidBackground"
  | "enableSnowBackground"
  | "enableFogBackground"
  | "enableRaindropBackground"
  | "enableSpectrum"
  | "enableParallaxTilt"
  | "enableCoverBreathing";

/** 特效项定义：绑定 settings.player.* 路径，供列表渲染与预设切换共用 */
interface EffectItem {
  key: string;
  path: BooleanEffectPath;
  labelKey: string;
  descKey: string;
}

const EFFECTS: EffectItem[] = [
  {
    key: "fluid",
    path: "enableFluidBackground",
    labelKey: "onboarding.effects.fluid",
    descKey: "onboarding.effects.fluidDesc",
  },
  {
    key: "snow",
    path: "enableSnowBackground",
    labelKey: "onboarding.effects.snow",
    descKey: "onboarding.effects.snowDesc",
  },
  {
    key: "fog",
    path: "enableFogBackground",
    labelKey: "onboarding.effects.fog",
    descKey: "onboarding.effects.fogDesc",
  },
  {
    key: "raindrop",
    path: "enableRaindropBackground",
    labelKey: "onboarding.effects.raindrop",
    descKey: "onboarding.effects.raindropDesc",
  },
  {
    key: "spectrum",
    path: "enableSpectrum",
    labelKey: "onboarding.effects.spectrum",
    descKey: "onboarding.effects.spectrumDesc",
  },
  {
    key: "parallax",
    path: "enableParallaxTilt",
    labelKey: "onboarding.effects.parallax",
    descKey: "onboarding.effects.parallaxDesc",
  },
  {
    key: "breathing",
    path: "enableCoverBreathing",
    labelKey: "onboarding.effects.breathing",
    descKey: "onboarding.effects.breathingDesc",
  },
];

/** 性能模式：仅保留低开销的流体 + 视差 + 呼吸 */
const applyPerformance = (): void => {
  settings.player.enableFluidBackground = true;
  settings.player.enableParallaxTilt = true;
  settings.player.enableCoverBreathing = true;
  settings.player.enableSnowBackground = false;
  settings.player.enableFogBackground = false;
  settings.player.enableRaindropBackground = false;
  settings.player.enableSpectrum = false;
};

/** 完整模式：所有特效全开 */
const applyFull = (): void => {
  settings.player.enableFluidBackground = true;
  settings.player.enableSnowBackground = true;
  settings.player.enableFogBackground = true;
  settings.player.enableRaindropBackground = true;
  settings.player.enableSpectrum = true;
  settings.player.enableParallaxTilt = true;
  settings.player.enableCoverBreathing = true;
};

/** 一键全开 / 全关 */
const enableAll = (): void => {
  for (const item of EFFECTS) {
    (settings.player[item.path] as boolean) = true;
  }
};
const disableAll = (): void => {
  for (const item of EFFECTS) {
    (settings.player[item.path] as boolean) = false;
  }
};
</script>

<template>
  <div class="flex flex-col max-w-2xl w-full mx-auto h-full overflow-hidden">
    <div class="flex-1 overflow-y-auto pr-1">
      <div class="flex items-center gap-3 mb-2">
        <IconSparkles class="size-6 text-primary" />
        <h2 class="text-2xl font-bold">{{ t("onboarding.effects.title") }}</h2>
      </div>
      <p class="text-on-surface-variant/70 mb-6 leading-relaxed">
        {{ t("onboarding.effects.subtitle") }}
      </p>

      <!-- 预设按钮 -->
      <div class="grid grid-cols-2 gap-3 mb-5">
        <button type="button" class="preset-card group" @click="applyPerformance">
          <div class="flex items-center gap-2 mb-1">
            <IconGauge class="size-5 text-primary" />
            <span class="font-semibold">{{ t("onboarding.effects.performanceMode") }}</span>
          </div>
          <p class="text-xs text-on-surface-variant/70 text-left leading-relaxed">
            {{ t("onboarding.effects.performanceDesc") }}
          </p>
        </button>
        <button type="button" class="preset-card group" @click="applyFull">
          <div class="flex items-center gap-2 mb-1">
            <IconSparkles class="size-5 text-primary" />
            <span class="font-semibold">{{ t("onboarding.effects.fullMode") }}</span>
          </div>
          <p class="text-xs text-on-surface-variant/70 text-left leading-relaxed">
            {{ t("onboarding.effects.fullDesc") }}
          </p>
        </button>
      </div>

      <!-- 特效逐项开关 -->
      <div class="flex flex-col gap-2 mb-6">
        <div v-for="item in EFFECTS" :key="item.key" class="effect-row">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium">{{ t(item.labelKey) }}</div>
            <div class="text-xs text-on-surface-variant/70 mt-0.5 truncate">
              {{ t(item.descKey) }}
            </div>
          </div>
          <SSwitch
            :model-value="settings.player[item.path]"
            @update:model-value="settings.player[item.path] = $event as boolean"
          />
        </div>
      </div>

      <!-- 全开 / 全关快捷 -->
      <div class="flex items-center gap-2 mb-4">
        <SButton variant="tertiary" size="small" round @click="enableAll">
          <template #icon><IconCheck /></template>
          {{ t("onboarding.effects.enableAll") }}
        </SButton>
        <SButton variant="tertiary" size="small" round @click="disableAll">
          {{ t("onboarding.effects.disableAll") }}
        </SButton>
      </div>
    </div>

    <div class="flex items-center gap-3 shrink-0 pt-4">
      <SButton variant="ghost" round @click="emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton type="primary" round @click="emit('next')">
        {{ t("onboarding.next") }}
        <template #icon><IconArrowRight /></template>
      </SButton>
    </div>
  </div>
</template>

<style scoped>
.preset-card {
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
  border-radius: 12px;
  background: rgb(from var(--color-on-surface) r g b / 4%);
  border: 1px solid rgb(from var(--color-primary) r g b / 12%);
  cursor: pointer;
  transition:
    background 0.2s,
    border-color 0.2s;
}
.preset-card:hover {
  background: rgb(from var(--color-on-surface) r g b / 8%);
  border-color: rgb(from var(--color-primary) r g b / 24%);
}
.effect-row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgb(from var(--color-on-surface) r g b / 4%);
  border: 1px solid rgb(from var(--color-primary) r g b / 10%);
}
</style>
