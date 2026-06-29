<script setup lang="ts">
import IconKeyboard from "~icons/lucide/keyboard";
import IconCheck from "~icons/lucide/check";
import IconChevronLeft from "~icons/lucide/chevron-left";

const { t } = useI18n();
defineProps<{ loading?: boolean }>();
const emit = defineEmits<{ (e: "next"): void; (e: "back"): void }>();

const TIPS = ["global", "local", "customize"] as const;
</script>

<template>
  <div class="flex flex-col max-w-2xl w-full mx-auto">
    <div class="flex items-center gap-3 mb-2">
      <IconKeyboard class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.hotkeys.title") }}</h2>
    </div>
    <p class="text-on-surface-variant/70 mb-6 leading-relaxed">
      {{ t("onboarding.hotkeys.subtitle") }}
    </p>

    <div class="bg-on-surface/4 border border-solid border-primary/10 rounded-xl p-5 mb-6">
      <div class="flex flex-col gap-3">
        <div v-for="tip in TIPS" :key="tip" class="flex items-start gap-3">
          <IconCheck class="size-4 text-primary shrink-0 mt-0.5" />
          <div class="flex-1">
            <div class="text-sm font-medium">{{ t(`onboarding.hotkeys.tips.${tip}.title`) }}</div>
            <div class="text-xs text-on-surface-variant/60 mt-0.5 leading-relaxed">
              {{ t(`onboarding.hotkeys.tips.${tip}.desc`) }}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-3">
      <SButton variant="ghost" round :disabled="loading" @click="emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton type="primary" round :loading="loading" @click="emit('next')">
        {{ t("onboarding.finish") }}
      </SButton>
    </div>
  </div>
</template>
