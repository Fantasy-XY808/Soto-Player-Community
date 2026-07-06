<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import type { AudioAnalysisResult } from "@shared/types/audioAnalysis";
import type { Track } from "@shared/types/player";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import {
  lastPick,
  previewPick,
  prefetchQueue,
  ensureAnalysis,
  type PickResult,
} from "@/services/automix";

const { t } = useI18n();
const status = useStatusStore();
const settings = useSettingsStore();

/** 当前曲 Track */
const currentTrack = computed<Track | null>(() => status.currentTrack);

/** 当前曲分析结果（响应式刷新） */
const currentAnalysis = shallowRef<AudioAnalysisResult | null>(null);

/** 是否正在试挑 */
const previewing = ref(false);

/** 是否正在预分析 */
const prefetching = ref(false);
/** 预分析进度 */
const prefetchDone = ref(0);
const prefetchTotal = ref(0);

/** Automix 是否启用 */
const enabled = computed(() => settings.system.automix?.enabled ?? false);

/** 预分析进度文案 */
const prefetchProgress = computed(() => {
  if (!prefetching.value) return "";
  return t("automix.prefetching", {
    done: prefetchDone.value,
    total: prefetchTotal.value,
  });
});

/** 加载当前曲分析结果 */
const loadCurrentAnalysis = async (): Promise<void> => {
  const track = currentTrack.value;
  if (!track) {
    currentAnalysis.value = null;
    return;
  }
  currentAnalysis.value = await ensureAnalysis(track).catch(() => null);
};

/** 监听当前曲变化刷新分析 */
watch(
  () => currentTrack.value?.id,
  () => {
    void loadCurrentAnalysis();
  },
  { immediate: true },
);

/** 试挑下一首 */
const handlePreview = async (): Promise<void> => {
  if (previewing.value) return;
  previewing.value = true;
  try {
    await previewPick();
  } finally {
    previewing.value = false;
  }
};

/** 预分析整个队列 */
const handlePrefetch = async (): Promise<void> => {
  if (prefetching.value) return;
  prefetching.value = true;
  prefetchDone.value = 0;
  prefetchTotal.value = 0;
  try {
    await prefetchQueue((done, total) => {
      prefetchDone.value = done;
      prefetchTotal.value = total;
    });
  } finally {
    prefetching.value = false;
  }
};

/** 跳转设置页 */
const goSettings = (): void => {
  void window.api.system.openSettings("automix");
};

/** 格式化 BPM 显示 */
const formatBpm = (v: number | undefined | null): string => {
  if (!v || v <= 0) return t("automix.unknown");
  return v.toFixed(1);
};

/** 格式化 LUFS 显示 */
const formatLufs = (v: number | undefined | null): string => {
  if (v === null || v === undefined || v <= -50) return t("automix.unknown");
  return `${v.toFixed(1)} LUFS`;
};

/** 试挑结果（响应式读取 lastPick） */
const pick = computed<PickResult | null>(() => lastPick.value);
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pt-2 pb-3">
      <div class="flex items-center gap-5">
        <div
          class="flex size-28 shrink-0 items-center justify-center rounded-2xl border border-solid border-primary/15 bg-primary/8"
        >
          <IconLucideDisc3 class="size-12 text-primary/60" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <div class="flex items-center gap-2">
            <h1 class="text-3xl font-bold text-on-surface text-balance">
              {{ t("automix.title") }}
            </h1>
            <span
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              :class="
                enabled
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'bg-zinc-500/15 text-zinc-500'
              "
            >
              {{ enabled ? t("automix.active") : t("automix.inactive") }}
            </span>
          </div>
          <p class="text-sm text-on-surface-variant/70">{{ t("automix.subtitle") }}</p>
        </div>
      </div>
    </div>

    <!-- 内容 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <!-- 未启用提示 -->
      <div
        v-if="!enabled"
        class="mx-auto mt-8 max-w-md rounded-xl border border-outline-variant/40 bg-surface-variant/20 p-6 text-center"
      >
        <IconLucideDisc3 class="mx-auto mb-3 size-12 text-on-surface-variant/40" />
        <div class="text-base font-medium text-on-surface">{{ t("automix.notEnabled") }}</div>
        <div class="mt-1 text-sm text-on-surface-variant/70">{{ t("automix.notEnabledHint") }}</div>
        <SButton type="primary" class="mt-4" @click="goSettings">
          {{ t("automix.goSettings") }}
        </SButton>
      </div>

      <div v-else class="mx-auto flex max-w-4xl flex-col gap-4">
        <!-- 当前曲目分析 -->
        <section class="rounded-xl border border-outline-variant/40 p-4">
          <h2 class="mb-3 text-sm font-semibold text-on-surface-variant">
            {{ t("automix.currentTrack") }}
          </h2>
          <div v-if="currentTrack" class="flex items-center gap-4">
            <img
              v-if="currentTrack.cover"
              :src="currentTrack.cover"
              :alt="currentTrack.title"
              decoding="async"
              class="size-16 rounded-lg object-cover"
            />
            <div
              v-else
              class="flex size-16 items-center justify-center rounded-lg bg-surface-variant/40"
            >
              <IconLucideMusic class="size-7 text-on-surface-variant/40" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-base font-medium text-on-surface">
                {{ currentTrack.title }}
              </div>
              <div class="mt-0.5 truncate text-sm text-on-surface-variant/70">
                {{ currentTrack.artists.map((a) => a.name).join(" / ") }}
              </div>
            </div>
          </div>
          <div v-else class="py-4 text-center text-sm text-on-surface-variant/50">
            {{ t("automix.noCurrent") }}
          </div>

          <!-- 分析数据 -->
          <div v-if="currentTrack" class="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="rounded-lg bg-surface-variant/20 px-3 py-2">
              <div class="text-xs text-on-surface-variant/60">{{ t("automix.bpm") }}</div>
              <div class="mt-0.5 text-sm font-medium text-on-surface">
                {{ formatBpm(currentAnalysis?.bpm) }}
              </div>
            </div>
            <div class="rounded-lg bg-surface-variant/20 px-3 py-2">
              <div class="text-xs text-on-surface-variant/60">{{ t("automix.key") }}</div>
              <div class="mt-0.5 text-sm font-medium text-on-surface">
                {{ currentAnalysis?.key || t("automix.unknown") }}
              </div>
            </div>
            <div class="rounded-lg bg-surface-variant/20 px-3 py-2">
              <div class="text-xs text-on-surface-variant/60">{{ t("automix.lufs") }}</div>
              <div class="mt-0.5 text-sm font-medium text-on-surface">
                {{ formatLufs(currentAnalysis?.lufs) }}
              </div>
            </div>
            <div class="rounded-lg bg-surface-variant/20 px-3 py-2">
              <div class="text-xs text-on-surface-variant/60">{{ t("automix.vocals") }}</div>
              <div class="mt-0.5 text-sm font-medium text-on-surface">
                {{
                  currentAnalysis
                    ? currentAnalysis.hasVocals
                      ? t("automix.yes")
                      : t("automix.no")
                    : t("automix.unknown")
                }}
              </div>
            </div>
          </div>
        </section>

        <!-- 上次选曲 -->
        <section class="rounded-xl border border-outline-variant/40 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-on-surface-variant">
              {{ t("automix.lastPick") }}
            </h2>
            <SButton
              variant="secondary"
              size="small"
              :disabled="previewing || !currentTrack"
              @click="handlePreview"
            >
              <template #icon><IconLucideWand2 /></template>
              {{ previewing ? t("automix.previewing") : t("automix.preview") }}
            </SButton>
          </div>
          <div v-if="pick" class="flex items-center gap-4">
            <img
              v-if="pick.track.cover"
              :src="pick.track.cover"
              :alt="pick.track.title"
              decoding="async"
              class="size-14 rounded-lg object-cover"
            />
            <div
              v-else
              class="flex size-14 items-center justify-center rounded-lg bg-surface-variant/40"
            >
              <IconLucideMusic class="size-6 text-on-surface-variant/40" />
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium text-on-surface">
                {{ pick.track.title }}
              </div>
              <div class="mt-0.5 truncate text-xs text-on-surface-variant/70">
                {{ pick.track.artists.map((a) => a.name).join(" / ") }}
              </div>
              <div class="mt-1 text-xs text-on-surface-variant/50">{{ pick.reason }}</div>
            </div>
          </div>
          <div v-else class="py-4 text-center text-sm text-on-surface-variant/50">
            {{ t("automix.noPick") }}
          </div>
        </section>

        <!-- 预分析 -->
        <section class="rounded-xl border border-outline-variant/40 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-on-surface-variant">
              {{ t("automix.prefetch") }}
            </h2>
            <SButton
              variant="secondary"
              size="small"
              :disabled="prefetching"
              @click="handlePrefetch"
            >
              <template #icon><IconLucideDatabase /></template>
              {{ prefetching ? prefetchProgress : t("automix.prefetch") }}
            </SButton>
          </div>
          <p class="text-xs text-on-surface-variant/60">
            {{ t("settings.automixAutoAnalyze.description") }}
          </p>
        </section>
      </div>
    </div>
  </div>
</template>
