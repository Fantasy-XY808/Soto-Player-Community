<script setup lang="ts">
import IconMusic from "~icons/lucide/music";
import IconFolder from "~icons/lucide/folder";
import IconServer from "~icons/lucide/server";
import IconSparkles from "~icons/lucide/sparkles";
import IconArrowRight from "~icons/lucide/arrow-right";

const { t } = useI18n();
const emit = defineEmits<{ (e: "next"): void }>();

const FEATURES = [
  { icon: IconFolder, key: "local" },
  { icon: IconMusic, key: "quality" },
  { icon: IconServer, key: "streaming" },
  { icon: IconSparkles, key: "lyrics" },
];
</script>

<template>
  <div class="flex flex-col items-center text-center w-full max-w-2xl mx-auto my-auto">
    <SLogo :size="80" class="mb-6" />
    <h1 class="text-3xl font-bold mb-2">{{ t("onboarding.welcome.title") }}</h1>
    <p class="text-on-surface-variant/70 mb-8 leading-relaxed">
      {{ t("onboarding.welcome.subtitle") }}
    </p>
    <div class="grid grid-cols-2 gap-3 w-full mb-10">
      <div
        v-for="feature in FEATURES"
        :key="feature.key"
        class="flex items-center gap-3 px-4 py-3 bg-on-surface/4 border border-solid border-primary/10 rounded-xl text-left"
      >
        <component :is="feature.icon" class="size-5 text-primary shrink-0" />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">
            {{ t(`onboarding.welcome.features.${feature.key}.title`) }}
          </div>
          <div class="text-xs text-on-surface-variant/60 truncate">
            {{ t(`onboarding.welcome.features.${feature.key}.desc`) }}
          </div>
        </div>
      </div>
    </div>
    <SButton type="primary" round @click="emit('next')">
      {{ t("onboarding.welcome.start") }}
      <template #icon><IconArrowRight /></template>
    </SButton>
  </div>
</template>
