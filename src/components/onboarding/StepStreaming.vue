<script setup lang="ts">
import IconServer from "~icons/lucide/server";
import IconCheck from "~icons/lucide/check";
import IconChevronLeft from "~icons/lucide/chevron-left";

const { t } = useI18n();
defineEmits<{ (e: "next"): void; (e: "back"): void }>();

const SERVERS = ["subsonic", "navidrome", "jellyfin", "emby"] as const;
</script>

<template>
  <div class="flex flex-col max-w-2xl w-full mx-auto">
    <div class="flex items-center gap-3 mb-2">
      <IconServer class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.streaming.title") }}</h2>
    </div>
    <p class="text-on-surface-variant/70 mb-6 leading-relaxed">
      {{ t("onboarding.streaming.subtitle") }}
    </p>

    <div class="bg-on-surface/4 border border-solid border-primary/10 rounded-xl p-5 mb-4">
      <div class="flex flex-col gap-3">
        <div v-for="key in SERVERS" :key="key" class="flex items-center gap-3">
          <IconCheck class="size-4 text-primary shrink-0" />
          <span class="text-sm">{{ t(`onboarding.streaming.servers.${key}`) }}</span>
        </div>
      </div>
    </div>

    <SAlert class="mb-6">{{ t("onboarding.streaming.hint") }}</SAlert>

    <div class="flex items-center gap-3">
      <SButton variant="ghost" round @click="$emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton type="primary" round @click="$emit('next')">
        {{ t("onboarding.next") }}
      </SButton>
    </div>
  </div>
</template>
