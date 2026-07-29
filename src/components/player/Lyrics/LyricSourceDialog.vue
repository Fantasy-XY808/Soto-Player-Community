<script setup lang="ts">
import type { Track } from "@shared/types/player";
import type { LyricFormat } from "@shared/types/lyrics";
import { PLATFORM_SHORT_NAME, ALL_PLATFORMS, type Platform } from "@shared/types/platform";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { toast } from "@/composables/useToast";

const { t } = useI18n();

const props = defineProps<{
  /** 是否打开 */
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const media = useMediaStore();
const settings = useSettingsStore();

/** 平台显示名 */
const platformLabel = (p: Platform): string => PLATFORM_SHORT_NAME[p] ?? p;

/** 单个平台抓取结果 */
interface PlatformResult {
  platform: Platform;
  loading: boolean;
  error: string | null;
  content: string | null;
  format: LyricFormat | null;
  hasTranslation: boolean;
  hasRomaji: boolean;
}

/** 各平台抓取状态 */
const results = reactive<Record<Platform, PlatformResult>>({
  netease: { platform: "netease", loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  qqmusic: { platform: "qqmusic", loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  kugou:   { platform: "kugou",   loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  qobuz:   { platform: "qobuz",   loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  tidal:   { platform: "tidal",   loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  archive: { platform: "archive", loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  bilibili: { platform: "bilibili", loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  // 以下平台暂未实现歌词抓取，占位以满足 Record 完整性
  spotify: { platform: "spotify", loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  mora: { platform: "mora", loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  prostudiomasters: { platform: "prostudiomasters", loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  "2l": { platform: "2l", loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
  // MusicFree：歌词抓取由 mfGetLyric 接管，此处占位以满足 Record 完整性
  musicfree: { platform: "musicfree", loading: false, error: null, content: null, format: null, hasTranslation: false, hasRomaji: false },
});

/** 当前预览的平台（默认当前正在使用的源） */
const previewPlatform = ref<Platform | null>(null);

/** 弹窗打开时拉取所有平台歌词 */
watch(
  () => props.open,
  async (val) => {
    if (!val) return;
    const track = media.track;
    if (!track) return;
    // 重置状态
    for (const p of ALL_PLATFORMS) {
      results[p].loading = true;
      results[p].error = null;
      results[p].content = null;
      results[p].format = null;
      results[p].hasTranslation = false;
      results[p].hasRomaji = false;
    }
    // 默认预览当前激活源
    const active = media.activeLyric;
    previewPlatform.value = active?.source === "online" ? (active.platform ?? null) : null;
    // 并行抓取所有平台
    await Promise.all(ALL_PLATFORMS.map((p) => fetchPlatform(p, track)));
    // 若没有预览平台，取首个有内容的
    if (!previewPlatform.value || !results[previewPlatform.value].content) {
      previewPlatform.value = ALL_PLATFORMS.find((p) => results[p].content) ?? null;
    }
  },
);

/** 抓取单个平台歌词 */
const fetchPlatform = async (platform: Platform, track: Track): Promise<void> => {
  const r = results[platform];
  r.loading = true;
  try {
    const mode = track.source === platform ? "byId" : "byQuery";
    const lookupId = platform === "qqmusic" ? (track.extId ?? track.id) : track.id;
    const resp =
      mode === "byId"
        ? await window.api.lyrics.matchById(platform, lookupId)
        : await window.api.lyrics.matchByQuery(platform, track);
    if (!resp.ok) {
      r.error = resp.error;
      r.content = null;
    } else if (!resp.data) {
      r.error = t("lyricSourceDialog.noResult");
      r.content = null;
    } else {
      r.content = resp.data.content;
      r.format = resp.data.format;
      r.hasTranslation = !!resp.data.translation;
      r.hasRomaji = !!resp.data.romaji;
      r.error = null;
    }
  } catch (err) {
    r.error = err instanceof Error ? err.message : String(err);
    r.content = null;
  } finally {
    r.loading = false;
  }
};

/** 当前预览的内容 */
const previewContent = computed(() => {
  if (!previewPlatform.value) return "";
  const r = results[previewPlatform.value];
  return r.content ?? "";
});

/** 当前预览的格式 */
const previewFormat = computed(() => {
  if (!previewPlatform.value) return null;
  return results[previewPlatform.value].format;
});

/** 应用此平台为偏好（写入 lyricSourcePreference） */
const applyPlatform = (platform: Platform): void => {
  settings.lyric.lyricSourcePreference = platform;
  toast.success(t("lyricSourceDialog.applied", { platform: platformLabel(platform) }));
};

/** 复制当前预览内容 */
const copyContent = async (): Promise<void> => {
  if (!previewContent.value) return;
  try {
    await navigator.clipboard.writeText(previewContent.value);
    toast.success(t("lyricSourceDialog.copySuccess"));
  } catch {
    toast.error(t("lyricSourceDialog.copyFailed"));
  }
};

/** 当前激活的歌词源（只读展示） */
const activeSource = computed(() => {
  const a = media.activeLyric;
  if (!a) return null;
  if (a.source === "online" && a.platform) {
    return { type: "online" as const, platform: a.platform, format: a.format };
  }
  if (a.source === "embedded") return { type: "embedded" as const, format: a.format };
  if (a.source === "external") return { type: "external" as const, format: a.format };
  return null;
});
</script>

<template>
  <SDialog
    :open="open"
    :title="t('lyricSourceDialog.title')"
    :description="t('lyricSourceDialog.description')"
    width="min(800px, calc(100vw - 32px))"
    @update:open="(v: boolean) => emit('update:open', v)"
  >
    <div class="flex gap-4 h-[min(520px,calc(100vh-220px)]">
      <!-- 左侧：平台列表 -->
      <div class="w-52 shrink-0 flex flex-col gap-1.5 overflow-y-auto pr-1">
        <!-- 当前激活源提示 -->
        <div
          v-if="activeSource"
          class="rounded-lg bg-surface-alt/60 px-3 py-2 text-xs text-on-surface-variant shrink-0"
        >
          <div class="text-on-surface-variant/70">{{ t("lyricSourceDialog.currentActive") }}</div>
          <div class="font-medium text-on-surface mt-0.5">
            <span v-if="activeSource.type === 'online'">
              {{ platformLabel(activeSource.platform) }} · {{ activeSource.format }}
            </span>
            <span v-else>
              {{ t(`lyricSourceDialog.source.${activeSource.type}`) }} · {{ activeSource.format }}
            </span>
          </div>
        </div>

        <!-- 各平台卡片 -->
        <div
          v-for="p in ALL_PLATFORMS"
          :key="p"
          :class="[
            'cursor-pointer transition-all rounded-lg border border-solid px-3 py-2',
            previewPlatform === p
              ? 'ring-2 ring-primary border-primary/30 bg-primary/5'
              : 'border-outline-variant/20 hover:bg-surface-alt/60',
          ]"
          @click="previewPlatform = p"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">{{ platformLabel(p) }}</div>
              <div v-if="results[p].loading" class="text-xs text-on-surface-variant/60 mt-0.5">
                {{ t("lyricSourceDialog.loading") }}
              </div>
              <div v-else-if="results[p].error" class="text-xs text-red-500 mt-0.5 truncate">
                {{ results[p].error }}
              </div>
              <div v-else-if="results[p].content" class="text-xs text-on-surface-variant/60 mt-0.5">
                {{ results[p].format }}
                <span v-if="results[p].hasTranslation" class="ml-1">译</span>
                <span v-if="results[p].hasRomaji" class="ml-1">音</span>
              </div>
              <div v-else class="text-xs text-on-surface-variant/40 mt-0.5">
                {{ t("lyricSourceDialog.noResult") }}
              </div>
            </div>
            <button
              v-if="results[p].content"
              class="text-xs px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
              @click.stop="applyPlatform(p)"
            >
              {{ t("lyricSourceDialog.apply") }}
            </button>
          </div>
        </div>

        <!-- auto 模式说明 -->
        <div class="mt-1 rounded-lg bg-surface-alt/40 px-3 py-2 text-xs text-on-surface-variant/70 shrink-0">
          <div class="font-medium text-on-surface-variant">{{ t("lyricSourceDialog.autoHint.title") }}</div>
          <div class="mt-1 leading-relaxed">{{ t("lyricSourceDialog.autoHint.desc") }}</div>
        </div>
      </div>

      <!-- 右侧：歌词全文预览 -->
      <div class="flex-1 flex flex-col min-w-0">
        <div class="flex items-center justify-between mb-2 shrink-0">
          <div class="text-sm text-on-surface-variant min-w-0 truncate">
            <span v-if="previewPlatform">
              {{ platformLabel(previewPlatform) }}
              <span v-if="previewFormat" class="ml-2 text-xs">({{ previewFormat }})</span>
            </span>
            <span v-else>{{ t("lyricSourceDialog.selectPlatform") }}</span>
          </div>
          <SButton size="small" variant="secondary" :disabled="!previewContent" @click="copyContent" class="shrink-0 ml-2">
            {{ t("lyricSourceDialog.copy") }}
          </SButton>
        </div>
        <pre
          class="flex-1 overflow-auto rounded-lg bg-surface-alt/40 p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words min-h-0"
        >{{ previewContent || t("lyricSourceDialog.emptyPreview") }}</pre>
      </div>
    </div>

    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
