<script setup lang="ts">
import type { PlayStatsSummary, TopArtist, TopTrack, HourlyStat } from "@shared/types/stats";
import type { Track } from "@shared/types/player";
import * as player from "@/core/player";
import { usePaletteExtractor } from "@/composables/usePaletteExtractor";

const { t } = useI18n();

const summary = ref<PlayStatsSummary | null>(null);
const topTracks = ref<TopTrack[]>([]);
const topArtists = ref<TopArtist[]>([]);
const hourly = ref<HourlyStat[]>([]);

const loading = ref(true);

/** Hero 区调色板：基于 Top 1 曲目封面提取，无数据时回退默认色 */
const { dominant, palette, extract: extractPalette, reset: resetPalette } = usePaletteExtractor();

/** 时长格式化：取较大单位 */
const formatDuration = (ms: number): { value: number; unit: "h" | "m" } => {
  const totalMin = Math.round(ms / 60000);
  if (totalMin >= 60) {
    return { value: Math.round((totalMin / 60) * 10) / 10, unit: "h" };
  }
  return { value: totalMin, unit: "m" };
};

/** 取小时分布中的最活跃 / 最安静时段 */
const peakHour = computed<{ hour: number; plays: number } | null>(() => {
  if (hourly.value.length === 0) return null;
  let max = hourly.value[0];
  for (const h of hourly.value) if (h.playCount > max.playCount) max = h;
  return max.playCount > 0 ? { hour: max.hour, plays: max.playCount } : null;
});

const quietHour = computed<{ hour: number; plays: number } | null>(() => {
  if (hourly.value.length === 0) return null;
  let min = hourly.value[0];
  for (const h of hourly.value) if (h.playCount < min.playCount) min = h;
  return { hour: min.hour, plays: min.playCount };
});

/** 24 小时柱图最大值，用于归一化高度 */
const hourlyMax = computed(() => {
  let m = 1;
  for (const h of hourly.value) if (h.playCount > m) m = h.playCount;
  return m;
});

/** 本周对比上周的环比百分比 */
const weekDelta = computed(() => {
  if (!summary.value) return null;
  const cur = summary.value.weekListenedMs;
  const prev = summary.value.lastWeekListenedMs;
  if (prev === 0) return cur > 0 ? null : 0;
  return Math.round(((cur - prev) / prev) * 100);
});

const totalDuration = computed(() =>
  summary.value ? formatDuration(summary.value.totalListenedMs) : { value: 0, unit: "m" },
);

const weekDuration = computed(() =>
  summary.value ? formatDuration(summary.value.weekListenedMs) : { value: 0, unit: "m" },
);

const lastWeekDuration = computed(() =>
  summary.value ? formatDuration(summary.value.lastWeekListenedMs) : { value: 0, unit: "m" },
);

/** 本周 vs 上周双向条形图归一化基准：取两者较大值 */
const weekBarBase = computed(() => {
  const a = summary.value?.weekListenedMs ?? 0;
  const b = summary.value?.lastWeekListenedMs ?? 0;
  return Math.max(a, b, 1);
});

/** 取封面 URL */
const coverUrl = (track: Track): string => track.cover ?? "";

/** Top 1 曲目（Hero 区右侧展示 + 调色板来源） */
const topTrack = computed<TopTrack | null>(() => topTracks.value[0] ?? null);

/** Top 艺人最大播放次数，用于横向进度条归一化 */
const topArtistMax = computed(() => {
  let m = 1;
  for (const a of topArtists.value) if (a.playCount > m) m = a.playCount;
  return m;
});

/** Top 曲目最大播放次数，用于横向进度条归一化 */
const topTrackMax = computed(() => {
  let m = 1;
  for (const t of topTracks.value) if (t.playCount > m) m = t.playCount;
  return m;
});

/** 艺人首字母（中文取首字，英文取首字母大写） */
const artistInitial = (name: string): string => {
  if (!name) return "?";
  const ch = name.trim().charAt(0);
  return /[a-zA-Z]/.test(ch) ? ch.toUpperCase() : ch;
};

/** 点击高频曲目直接播放 */
const handlePlayTrack = (track: Track): void => {
  void player.playNow(track);
};

/** Hero 区背景渐变样式：基于调色板 */
const heroBackground = computed(() => {
  const c = (rgb: { r: number; g: number; b: number }) => `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  const d = dominant.value;
  const p2 = palette.value[1] ?? d;
  const p3 = palette.value[2] ?? p2;
  return {
    backgroundImage: `linear-gradient(135deg, ${c(d)} 0%, ${c(p2)} 50%, ${c(p3)} 100%)`,
  };
});

/** Hero 区文字前景色（自动反色） */
const heroForeground = computed(() => {
  const f = palette.value[0] ?? { r: 255, g: 255, b: 255 };
  // 简化：dominant 亮度 > 140 用黑字，否则用白字
  const lum = 0.299 * f.r + 0.587 * f.g + 0.114 * f.b;
  return lum > 140 ? "rgba(0,0,0,0.9)" : "rgba(255,255,255,0.96)";
});

const heroForegroundMuted = computed(() => {
  const f = palette.value[0] ?? { r: 255, g: 255, b: 255 };
  const lum = 0.299 * f.r + 0.587 * f.g + 0.114 * f.b;
  return lum > 140 ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.65)";
});

const loadData = async (): Promise<void> => {
  loading.value = true;
  try {
    const [s, tracks, artists, hours] = await Promise.all([
      window.api.stats.getStatsSummary(),
      window.api.stats.getTopTracks(10),
      window.api.stats.getTopArtists(10),
      window.api.stats.getHourlyDistribution(),
    ]);
    summary.value = s;
    topTracks.value = tracks;
    topArtists.value = artists;
    hourly.value = hours;
  } catch (error) {
    console.warn("[music-report] load failed:", error);
  } finally {
    loading.value = false;
  }
};

const hasData = computed(
  () => summary.value !== null && summary.value.totalPlayCount > 0,
);

// Top 1 曲目封面变化时提取调色板
watch(
  () => topTrack.value?.track.cover ?? topTrack.value?.track.coverOriginal ?? "",
  (url) => {
    if (url) extractPalette(url);
    else resetPalette();
  },
);

onMounted(() => {
  void loadData();
});
</script>

<template>
  <div class="flex flex-col h-full overflow-y-auto">
    <!-- 顶栏 -->
    <div class="shrink-0 px-6 pt-4 pb-2">
      <h1 class="text-3xl font-bold text-on-surface">{{ t("musicReport.title") }}</h1>
      <p class="text-sm text-on-surface-variant/60 mt-1">{{ t("musicReport.subtitle") }}</p>
    </div>

    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <IconLucideLoader2 class="size-8 animate-spin text-on-surface-variant/40" />
    </div>

    <div v-else-if="!hasData" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/50">
        <IconLucideBarChart3 class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm">{{ t("musicReport.empty") }}</div>
      </div>
    </div>

    <div v-else class="flex-1 px-6 pb-8 space-y-5">
      <!-- Hero 区：基于 Top 1 曲目调色板的渐变背景 + 大字号核心数据 -->
      <div
        class="relative overflow-hidden rounded-2xl p-6 flex items-center gap-6"
        :style="heroBackground"
      >
        <!-- 装饰光晕 -->
        <div
          class="absolute -top-12 -right-12 size-48 rounded-full opacity-30 blur-3xl pointer-events-none"
          :style="{ background: 'rgba(255,255,255,0.4)' }"
        />
        <div class="relative flex-1 min-w-0">
          <div
            class="text-xs uppercase tracking-wider mb-2"
            :style="{ color: heroForegroundMuted }"
          >
            {{ t("musicReport.totalDuration") }}
          </div>
          <div class="flex items-baseline gap-2 mb-4">
            <span
              class="text-6xl font-bold tabular-nums leading-none"
              :style="{ color: heroForeground }"
            >
              {{ totalDuration.value }}
            </span>
            <span class="text-lg" :style="{ color: heroForegroundMuted }">
              {{ totalDuration.unit === "h" ? t("home.stats.unitHour") : t("musicReport.minutes") }}
            </span>
          </div>
          <div class="flex items-center gap-6">
            <div>
              <div class="text-xs mb-0.5" :style="{ color: heroForegroundMuted }">
                {{ t("musicReport.totalPlays") }}
              </div>
              <div
                class="text-xl font-semibold tabular-nums"
                :style="{ color: heroForeground }"
              >
                {{ summary?.totalPlayCount ?? 0 }}
                <span class="text-xs font-normal" :style="{ color: heroForegroundMuted }">
                  {{ t("home.stats.unitSong") }}
                </span>
              </div>
            </div>
            <div class="w-px h-8 opacity-30" :style="{ background: heroForeground }" />
            <div>
              <div class="text-xs mb-0.5" :style="{ color: heroForegroundMuted }">
                {{ t("musicReport.streak") }}
              </div>
              <div
                class="text-xl font-semibold tabular-nums"
                :style="{ color: heroForeground }"
              >
                {{ summary?.streakDays ?? 0 }}
                <span class="text-xs font-normal" :style="{ color: heroForegroundMuted }">
                  {{ t("home.stats.unitDay") }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <!-- Top 1 曲目封面 -->
        <div v-if="topTrack" class="relative shrink-0 hidden md:block">
          <div class="size-32 rounded-xl overflow-hidden shadow-lg">
            <img
              v-if="coverUrl(topTrack.track)"
              :src="coverUrl(topTrack.track)"
              :alt="topTrack.track.title"
              class="size-full object-cover"
              loading="lazy"
              decoding="async"
            />
            <div v-else class="size-full bg-black/20 flex items-center justify-center">
              <IconLucideMusic class="size-10 opacity-40" :style="{ color: heroForeground }" />
            </div>
          </div>
        </div>
      </div>

      <!-- 本周 vs 上周：水平双向条形图（背对背） -->
      <div class="rounded-2xl bg-surface-variant/10 p-5 border border-outline-variant/30">
        <div class="flex items-center justify-between mb-4">
          <div class="text-sm font-medium text-on-surface">{{ t("musicReport.thisWeek") }}</div>
          <div
            v-if="weekDelta !== null"
            class="text-xs px-2 py-0.5 rounded-full"
            :class="
              weekDelta > 0
                ? 'bg-primary/15 text-primary'
                : weekDelta < 0
                  ? 'bg-error/15 text-error'
                  : 'bg-on-surface-variant/15 text-on-surface-variant'
            "
          >
            {{ weekDelta > 0 ? "+" : "" }}{{ weekDelta }}%
          </div>
        </div>
        <div class="space-y-3">
          <!-- 本周条 -->
          <div class="flex items-center gap-3">
            <div class="w-16 text-xs text-on-surface-variant/60 text-right shrink-0">
              {{ t("musicReport.thisWeek") }}
            </div>
            <div class="flex-1 h-7 bg-surface-variant/20 rounded-md overflow-hidden relative">
              <div
                class="absolute inset-y-0 left-0 bg-primary/80 rounded-md transition-all duration-700 ease-out flex items-center justify-end px-2"
                :style="{ width: `${Math.max(((summary?.weekListenedMs ?? 0) / weekBarBase) * 100, 2)}%` }"
              >
                <span class="text-xs text-on-primary font-medium tabular-nums">
                  {{ weekDuration.value }}{{ weekDuration.unit === "h" ? "h" : "m" }}
                </span>
              </div>
            </div>
            <div class="w-20 text-xs text-on-surface-variant/50 shrink-0">
              {{ summary?.weekPlayCount ?? 0 }} {{ t("home.stats.unitSong") }}
            </div>
          </div>
          <!-- 上周条 -->
          <div class="flex items-center gap-3">
            <div class="w-16 text-xs text-on-surface-variant/60 text-right shrink-0">
              {{ t("musicReport.lastWeek") }}
            </div>
            <div class="flex-1 h-7 bg-surface-variant/20 rounded-md overflow-hidden relative">
              <div
                class="absolute inset-y-0 left-0 bg-on-surface-variant/40 rounded-md transition-all duration-700 ease-out flex items-center justify-end px-2"
                :style="{ width: `${Math.max(((summary?.lastWeekListenedMs ?? 0) / weekBarBase) * 100, 2)}%` }"
              >
                <span
                  v-if="lastWeekDuration.value > 0"
                  class="text-xs text-on-surface font-medium tabular-nums"
                >
                  {{ lastWeekDuration.value }}{{ lastWeekDuration.unit === "h" ? "h" : "m" }}
                </span>
              </div>
            </div>
            <div class="w-20 text-xs text-on-surface-variant/50 shrink-0 shrink-0">—</div>
          </div>
        </div>
      </div>

      <!-- 24 小时分布柱图：加 hover 高亮 + 入场动画 -->
      <div class="rounded-2xl bg-surface-variant/10 p-5 border border-outline-variant/30">
        <div class="flex items-center justify-between mb-4">
          <div class="text-sm font-medium text-on-surface">{{ t("musicReport.hourlyTitle") }}</div>
          <div class="flex items-center gap-3 text-xs text-on-surface-variant/60">
            <span v-if="peakHour">
              {{ t("musicReport.peakHour") }}:
              <span class="text-on-surface font-medium">{{ peakHour.hour }}:00</span>
              ({{ peakHour.plays }})
            </span>
            <span v-if="quietHour && quietHour.plays === 0">
              {{ t("musicReport.quietHour") }}:
              <span class="text-on-surface font-medium">{{ quietHour.hour }}:00</span>
            </span>
          </div>
        </div>
        <div class="flex items-end gap-[3px] h-36">
          <div
            v-for="h in hourly"
            :key="h.hour"
            class="flex-1 group relative h-full flex items-end"
          >
            <!-- hover tooltip -->
            <div
              class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 rounded-md bg-surface border border-outline-variant/40 text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-md z-10"
            >
              <span class="text-on-surface-variant">{{ h.hour }}:00</span>
              <span class="text-on-surface font-medium ml-1.5">{{ h.playCount }}</span>
            </div>
            <div
              class="w-full rounded-t-sm transition-all duration-300 bg-primary/70 group-hover:bg-primary origin-bottom"
              :style="{
                height: `${Math.max((h.playCount / hourlyMax) * 100, h.playCount > 0 ? 4 : 0)}%`,
                animationDelay: `${h.hour * 20}ms`,
              }"
            />
          </div>
        </div>
        <div class="flex justify-between mt-2 text-[10px] text-on-surface-variant/40">
          <span>0</span>
          <span>6</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>
      </div>

      <!-- 高频艺人 + 高频曲目 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- 高频艺人：首字母圆头像 + 横向进度条 -->
        <div class="rounded-2xl bg-surface-variant/10 p-5 border border-outline-variant/30">
          <div class="text-sm font-medium text-on-surface mb-4">
            {{ t("musicReport.topArtists") }}
          </div>
          <div v-if="topArtists.length === 0" class="text-xs text-on-surface-variant/40 py-4 text-center">
            {{ t("common.noData") }}
          </div>
          <div v-else class="space-y-3">
            <div
              v-for="(artist, idx) in topArtists"
              :key="artist.name"
              class="flex items-center gap-3"
            >
              <div
                class="shrink-0 size-9 rounded-full flex items-center justify-center text-sm font-semibold overflow-hidden"
                :class="
                  idx < 3
                    ? 'bg-primary text-on-primary'
                    : 'bg-on-surface-variant/15 text-on-surface-variant'
                "
              >
                {{ artistInitial(artist.name) }}
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-sm text-on-surface truncate">{{ artist.name }}</span>
                  <span class="text-xs text-on-surface-variant/50 tabular-nums shrink-0 ml-2">
                    {{ artist.playCount }} {{ t("home.stats.unitSong") }}
                  </span>
                </div>
                <div class="h-1 bg-surface-variant/20 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all duration-500"
                    :class="idx < 3 ? 'bg-primary' : 'bg-on-surface-variant/40'"
                    :style="{ width: `${(artist.playCount / topArtistMax) * 100}%` }"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 高频曲目：封面 + 横向进度条 -->
        <div class="rounded-2xl bg-surface-variant/10 p-5 border border-outline-variant/30">
          <div class="text-sm font-medium text-on-surface mb-4">
            {{ t("musicReport.topSongs") }}
          </div>
          <div v-if="topTracks.length === 0" class="text-xs text-on-surface-variant/40 py-4 text-center">
            {{ t("common.noData") }}
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="(item, idx) in topTracks"
              :key="item.track.id"
              class="flex items-center gap-3 p-1.5 rounded-lg hover:bg-surface-variant/15 cursor-pointer transition-colors"
              @click="handlePlayTrack(item.track)"
            >
              <span
                class="shrink-0 size-5 rounded-full flex items-center justify-center text-[10px] font-semibold"
                :class="
                  idx < 3
                    ? 'bg-primary text-on-primary'
                    : 'bg-on-surface-variant/15 text-on-surface-variant'
                "
              >
                {{ idx + 1 }}
              </span>
              <div class="shrink-0 size-9 rounded overflow-hidden bg-on-surface-variant/10">
                <img
                  v-if="coverUrl(item.track)"
                  :src="coverUrl(item.track)"
                  :alt="item.track.title"
                  class="size-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm text-on-surface truncate">{{ item.track.title }}</div>
                <div class="text-xs text-on-surface-variant/50 truncate mb-1">
                  {{ item.track.artists?.[0]?.name ?? "—" }}
                </div>
                <div class="h-1 bg-surface-variant/20 rounded-full overflow-hidden">
                  <div
                    class="h-full rounded-full transition-all duration-500"
                    :class="idx < 3 ? 'bg-primary' : 'bg-on-surface-variant/40'"
                    :style="{ width: `${(item.playCount / topTrackMax) * 100}%` }"
                  />
                </div>
              </div>
              <div class="text-xs text-on-surface-variant/40 tabular-nums shrink-0">
                {{ item.playCount }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
