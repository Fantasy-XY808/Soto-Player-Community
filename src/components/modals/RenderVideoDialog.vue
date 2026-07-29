<script setup lang="ts">
/**
 * 视频渲染配置对话框
 *
 * 入口：歌曲右键菜单 → "渲染为视频"
 * - single 模式：渲染当前曲为独立视频文件
 * - merge 模式：按顺序串接多首曲为单个视频（含切歌过渡动画）
 *
 * 配置项：格式 / 分辨率 / 帧率 / 视频码率 / 输出目录 / 渲染过渡
 * 配置完成后调用 window.api.renderVideo.start 入队
 */
import { useRenderVideoDialog } from "@/composables/useRenderVideoDialog";
import { useRenderVideoStore } from "@/stores/renderVideo";
import type {
  RenderVideoFormat,
  RenderVideoResolution,
  RenderVideoFps,
  RenderVideoMode,
  RenderVideoRequest,
  RenderVideoTask,
} from "@shared/types/renderVideo";
import type { PluginQuality } from "@shared/types/plugin";
import type { QualityLevel } from "@/utils/quality";
import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { toast } from "@/composables/useToast";
import { resolveDownloadSource } from "@/services/downloadSource";
import { parseLyric } from "@/utils/lyric/parse";
import { applyLyricExclude } from "@/utils/lyric/lyricStripper";
import { normalizeLyricLines } from "@/utils/lyric/normalize";
import type { LyricLine, LyricInput } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import IconFolderOpen from "~icons/lucide/folder-open";
import IconVideo from "~icons/lucide/video";
import IconX from "~icons/lucide/x";
import IconCheck from "~icons/lucide/check";
import IconLoader from "~icons/lucide/loader-2";

const { t } = useI18n();
const settings = useSettingsStore();
const theme = useThemeStore();
const renderVideoStore = useRenderVideoStore();
const {
  open,
  tracks,
  mode,
  format,
  resolution,
  fps,
  videoBitrate,
  renderTransition,
  hide,
} = useRenderVideoDialog();

/** 输出目录（运行时从主进程拉取） */
const outputDir = ref("");

/** 任务列表（复用全局 store，dialog 关闭后订阅仍活跃） */
const tasks = computed<RenderVideoTask[]>(() => renderVideoStore.tasks);

/** 当前编辑中的任务 ID（用于在 UI 上展示进度） */
const activeTaskIds = computed(() =>
  tasks.value
    .filter((t) => t.status === "queued" || t.status === "rendering" || t.status === "muxing")
    .map((t) => t.taskId),
);

/** 是否有任务正在渲染（用于禁用开始按钮） */
const hasActiveTask = computed(() => activeTaskIds.value.length > 0);

/** 拉取输出目录与已有任务列表 */
const refreshDirAndTasks = async (): Promise<void> => {
  try {
    outputDir.value = await window.api.renderVideo.getDir();
    await renderVideoStore.refreshTasks();
  } catch (err) {
    console.warn("[RenderVideoDialog] refresh failed", err);
  }
};

watch(open, async (isOpen) => {
  if (isOpen) {
    await refreshDirAndTasks();
  }
});

onMounted(() => {
  // 复用全局 store 的 IPC 订阅（幂等），dialog 关闭后订阅仍活跃
  renderVideoStore.subscribe();
  void renderVideoStore.refreshTasks();
});

onBeforeUnmount(() => {
  // 订阅由 store 持有，dialog 卸载不注销
});

/** 选择输出目录 */
const onPickDir = async (): Promise<void> => {
  const result = await window.api.renderVideo.pickDir();
  if (result.ok) {
    outputDir.value = result.dir;
  }
};

/** 渲染模式选项 */
const modeOptions: Array<{ value: RenderVideoMode; label: string; desc: string }> = [
  {
    value: "single",
    label: t("renderVideo.mode.single"),
    desc: t("renderVideo.mode.singleDesc"),
  },
  {
    value: "merge",
    label: t("renderVideo.mode.merge"),
    desc: t("renderVideo.mode.mergeDesc"),
  },
];

/** 格式选项 */
const formatOptions: Array<{ value: RenderVideoFormat; label: string }> = [
  { value: "webm", label: "WebM (VP9/Opus)" },
  { value: "mp4", label: "MP4 (H.264/AAC)" },
];

/** 分辨率选项 */
const resolutionOptions: Array<{ value: RenderVideoResolution; label: string }> = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
  { value: "1440p", label: "1440p (2K)" },
  { value: "2160p", label: "2160p (4K)" },
];

/** 帧率选项 */
const fpsOptions: Array<{ value: RenderVideoFps; label: string }> = [
  { value: 24, label: "24 fps" },
  { value: 30, label: "30 fps" },
  { value: 60, label: "60 fps" },
];

/** 码率预设（Mbps），0 表示自动 */
const bitratePresets = [0, 4, 8, 12, 16, 24, 40];
const bitrateMbps = computed<number>({
  get: () => (videoBitrate.value === 0 ? 0 : Math.round(videoBitrate.value / 1_000_000)),
  set: (v) => {
    videoBitrate.value = v === 0 ? 0 : v * 1_000_000;
  },
});

/** 当前曲目的默认音质档位 */
const qualityOptions = computed(() => {
  const list: Array<{ value: PluginQuality; labelKey: string }> = [
    { value: "jymaster", labelKey: "settings.songLevel.jymaster" },
    { value: "sky", labelKey: "settings.songLevel.sky" },
    { value: "jyeffect", labelKey: "settings.songLevel.jyeffect" },
    { value: "hi-res", labelKey: "settings.songLevel.hi-res" },
    { value: "lossless", labelKey: "settings.songLevel.lossless" },
    { value: "hq", labelKey: "settings.songLevel.hq" },
    { value: "sq", labelKey: "settings.songLevel.sq" },
    { value: "lq", labelKey: "settings.songLevel.lq" },
  ];
  return list.map((opt) => ({
    value: opt.value,
    label: t(opt.labelKey),
  }));
});

/** 选中音质（默认跟随播放设置） */
const selectedQuality = ref<PluginQuality>(
  (settings.player.songLevel as QualityLevel as PluginQuality) ?? "hq",
);

/** 移除曲目（仅在 merge 模式有效） */
const removeTrack = (index: number): void => {
  if (mode.value !== "merge") return;
  tracks.value.splice(index, 1);
};

/** 移动曲目顺序（merge 模式） */
const moveTrack = (index: number, direction: -1 | 1): void => {
  if (mode.value !== "merge") return;
  const target = index + direction;
  if (target < 0 || target >= tracks.value.length) return;
  const list = tracks.value;
  [list[index], list[target]] = [list[target], list[index]];
};

/** 渲染中：禁用开始按钮 */
const isStarting = ref(false);

/**
 * 拉取并解析单首曲目的歌词
 *
 * 按 settings.lyric.lyricSourceOrder 顺序尝试各平台：
 * - 同平台 track 走 matchById（精确）
 * - 跨平台走 matchByQuery（模糊搜索打分）
 * 任一平台返回有效数据即停止；全部失败返回空数组
 *
 * 与 media.setLyric 一致地走 parseLyric + applyLyricExclude + normalizeLyricLines
 *
 * @param track 待渲染曲目
 * @returns 已解析的歌词行数组（空数组表示无歌词）
 */
const fetchParsedLyric = async (track: Track): Promise<LyricLine[]> => {
  const sourceOrder = settings.lyric.lyricSourceOrder ?? [];
  const preferredLang = settings.locale;
  for (const platform of sourceOrder) {
    try {
      const mode = track.source === platform ? "byId" : "byQuery";
      // QQ 音乐 lyric 接口要数字 songID
      const lookupId = platform === "qqmusic" ? (track.extId ?? track.id) : track.id;
      const resp =
        mode === "byId"
          ? await window.api.lyrics.matchById(platform, lookupId)
          : await window.api.lyrics.matchByQuery(platform, track);
      if (!resp.ok || !resp.data) continue;
      const data = resp.data;
      const input: LyricInput = {
        content: data.content,
        translation: data.translation,
        translationFormat: data.translationFormat,
        romaji: data.romaji,
        romajiFormat: data.romajiFormat,
      };
      // 与 media.setLyric 一致的解析链
      const lines = parseLyric(input, data.format, preferredLang);
      const excluded = applyLyricExclude(lines, track);
      normalizeLyricLines(excluded);
      if (excluded.length > 0) return excluded;
      // 当前平台解析后无有效行，继续尝试下一平台
    } catch (err) {
      console.warn(`[RenderVideo] 歌词拉取失败 platform=${platform} track=${track.title}`, err);
    }
  }
  return [];
};

/**
 * 序列化当前 settings store 为快照
 *
 * 取 locale / appearance / player / lyric / system 五大段
 * 使用 toRaw 解包响应式代理，避免 IPC 序列化时 Vue 拦截器报错
 */
const serializeSettingsSnapshot = (): RenderVideoRequest["settingsSnapshot"] => {
  return {
    locale: settings.locale,
    appearance: toRaw(settings.appearance) as Record<string, unknown>,
    player: toRaw(settings.player) as Record<string, unknown>,
    lyric: toRaw(settings.lyric) as Record<string, unknown>,
    system: toRaw(settings.system) as Record<string, unknown>,
  };
};

/**
 * 序列化当前 theme store 为快照
 *
 * 取 mode / source / customColor / globalTint / appearanceStyle / imageBackground /
 * imageBackgroundColor 七个字段。渲染窗口使用独立 partition，theme store 持久化值
 * 在渲染窗口侧为空，必须通过快照下发才能保证主题与主窗口一致。
 *
 * imageBackground 是 reactive，使用 toRaw 解包后浅拷贝避免 IPC 序列化时 Vue 拦截器报错。
 */
const serializeThemeSnapshot = (): RenderVideoRequest["themeSnapshot"] => {
  const rawBg = toRaw(theme.imageBackground);
  return {
    mode: theme.mode,
    source: theme.source,
    customColor: theme.customColor,
    globalTint: theme.globalTint,
    appearanceStyle: theme.appearanceStyle,
    imageBackground: {
      src: rawBg.src,
      blur: rawBg.blur,
      dim: rawBg.dim,
      scale: rawBg.scale,
    },
    imageBackgroundColor: theme.imageBackgroundColor,
    // 主窗口 src/core/player 在 load 时通过 extractColorFromUrl 异步写入 coverColor
    // 渲染窗口不调用 src/core/player，必须显式下发，否则 source="cover" 主题与背景色失效
    coverColor: theme.coverColor,
  };
};

/** 启动渲染任务 */
const onStart = async (): Promise<void> => {
  if (tracks.value.length === 0) {
    toast.warning(t("renderVideo.toast.noTracks"));
    return;
  }
  isStarting.value = true;
  try {
    const taskId = crypto.randomUUID();
    // 预解析音频 URL（与下载/播放同源），主进程不再二次解析
    const level = selectedQuality.value as QualityLevel;
    const resolvedTracks = tracks.value;
    const audioUrls: string[] = [];
    const parsedLyrics: LyricLine[][] = [];
    // 串行处理：URL 解析 + 歌词拉取并行（同曲内独立）
    for (const track of resolvedTracks) {
      try {
        const [source, lyricLines] = await Promise.all([
          resolveDownloadSource(track, level),
          fetchParsedLyric(track),
        ]);
        if (source?.url) {
          audioUrls.push(source.url);
        } else if (track.path) {
          // 本地文件回退使用 path
          audioUrls.push(`file:///${track.path.replace(/\\/g, "/").replace(/^\/+/, "")}`);
        } else {
          throw new Error(`[ERR-70004-B] 无法解析音频源：${track.title}`);
        }
        parsedLyrics.push(lyricLines);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`${t("renderVideo.toast.startFailed")}: ${message}`);
        return;
      }
    }
    const req: RenderVideoRequest = {
      taskId,
      mode: mode.value,
      tracks: resolvedTracks,
      audioUrls,
      parsedLyrics,
      settingsSnapshot: serializeSettingsSnapshot(),
      themeSnapshot: serializeThemeSnapshot(),
      quality: selectedQuality.value,
      format: format.value,
      resolution: resolution.value,
      fps: fps.value,
      videoBitrate: videoBitrate.value,
      outputDir: outputDir.value,
      renderTransition: renderTransition.value,
      trackTransitionStyle: settings.player.trackTransitionStyle ?? "scale",
    };
    const result = await window.api.renderVideo.start(req);
    if (!result.ok) {
      toast.error(result.error ?? t("renderVideo.toast.startFailed"));
      return;
    }
    toast.success(t("renderVideo.toast.started"));
    hide();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`${t("renderVideo.toast.startFailed")}: ${message}`);
  } finally {
    isStarting.value = false;
  }
};

/** 取消任务 */
const onCancelTask = async (taskId: string): Promise<void> => {
  try {
    await window.api.renderVideo.cancel(taskId);
  } catch (err) {
    console.warn("[ERR-70008-D] 取消任务失败", err);
  }
};

/** 打开输出目录 */
const onOpenOutputDir = (): void => {
  if (outputDir.value) {
    window.api.system.showInExplorer(outputDir.value);
  }
};

/** 格式化进度百分比 */
const formatProgress = (task: RenderVideoTask): number => {
  if (task.currentDurationMs <= 0) return 0;
  const currentRatio = Math.min(1, task.renderedMs / task.currentDurationMs);
  const totalRatio =
    task.total > 0 ? (task.currentIndex + currentRatio) / task.total : currentRatio;
  return Math.round(totalRatio * 100);
};

/** 状态文案映射 */
const statusText = (status: RenderVideoTask["status"]): string => {
  return t(`renderVideo.status.${status}`);
};

/** 计算总预估时长（用于预览） */
const totalDurationMs = computed(() =>
  tracks.value.reduce((sum, t) => sum + (t.duration ?? 0), 0),
);
const formatDuration = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('renderVideo.title')"
    width="min(640px, calc(100vw - 32px))"
    @update:open="(v) => !v && hide()"
  >
    <div class="flex flex-col gap-5">
      <!-- 曲目列表预览 -->
      <SCard class="flex flex-col gap-2 p-3">
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-on-surface">{{ t("renderVideo.tracksLabel") }}</span>
          <span class="text-xs text-on-surface-variant/70">
            {{ tracks.length }} {{ t("renderVideo.tracksUnit") }} ·
            {{ formatDuration(totalDurationMs) }}
          </span>
        </div>
        <div class="max-h-32 overflow-y-auto flex flex-col gap-1">
          <div
            v-for="(track, index) in tracks"
            :key="`${track.id}-${index}`"
            class="flex items-center gap-2 px-2 py-1.5 rounded bg-black/5 dark:bg-white/5 text-xs"
          >
            <span class="w-5 text-center text-on-surface-variant/70 tabular-nums">
              {{ index + 1 }}
            </span>
            <SImg
              v-if="track.cover"
              :src="track.cover"
              class="w-8 h-8 rounded object-cover shrink-0"
              :alt="track.title"
            />
            <div class="flex-1 min-w-0 flex flex-col">
              <span class="truncate text-on-surface">{{ track.title }}</span>
              <span class="truncate text-on-surface-variant/70">
                {{ track.artists?.map((a) => a.name).join(" / ") ?? "" }}
              </span>
            </div>
            <div
              v-if="mode === 'merge'"
              class="flex items-center gap-0.5 shrink-0"
            >
              <SButton
                size="small"
                variant="ghost"
                :disabled="index === 0"
                class="!px-1 !py-0.5 !h-6"
                @click="moveTrack(index, -1)"
              >
                ↑
              </SButton>
              <SButton
                size="small"
                variant="ghost"
                :disabled="index === tracks.length - 1"
                class="!px-1 !py-0.5 !h-6"
                @click="moveTrack(index, 1)"
              >
                ↓
              </SButton>
              <SButton
                size="small"
                variant="ghost"
                class="!px-1 !py-0.5 !h-6"
                @click="removeTrack(index)"
              >
                <IconX class="w-3.5 h-3.5" />
              </SButton>
            </div>
          </div>
        </div>
      </SCard>

      <!-- 渲染模式 -->
      <div class="flex flex-col gap-2">
        <span class="text-sm text-on-surface">{{ t("renderVideo.mode.label") }}</span>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="opt in modeOptions"
            :key="opt.value"
            type="button"
            :class="[
              'flex flex-col gap-1 p-3 rounded-lg border text-left transition-colors',
              mode === opt.value
                ? 'border-primary bg-primary/10'
                : 'border-outline-variant/30 hover:border-primary/50',
            ]"
            @click="mode = opt.value"
          >
            <span class="text-sm font-medium text-on-surface">{{ opt.label }}</span>
            <span class="text-xs text-on-surface-variant/70">{{ opt.desc }}</span>
          </button>
        </div>
      </div>

      <!-- 音质档位 -->
      <div class="flex flex-col gap-2">
        <span class="text-sm text-on-surface">{{ t("renderVideo.qualityLabel") }}</span>
        <SSelect v-model="selectedQuality" :options="qualityOptions" />
      </div>

      <!-- 视频格式 -->
      <div class="flex flex-col gap-2">
        <span class="text-sm text-on-surface">{{ t("renderVideo.formatLabel") }}</span>
        <SRadioGroup :value="format" @update:value="format = $event as RenderVideoFormat">
          <SRadio
            v-for="opt in formatOptions"
            :key="opt.value"
            :value="opt.value"
            :label="opt.label"
          />
        </SRadioGroup>
      </div>

      <!-- 分辨率 -->
      <div class="flex flex-col gap-2">
        <span class="text-sm text-on-surface">{{ t("renderVideo.resolutionLabel") }}</span>
        <SRadioGroup
          :value="resolution"
          @update:value="resolution = $event as RenderVideoResolution"
        >
          <SRadio
            v-for="opt in resolutionOptions"
            :key="opt.value"
            :value="opt.value"
            :label="opt.label"
          />
        </SRadioGroup>
      </div>

      <!-- 帧率 -->
      <div class="flex flex-col gap-2">
        <span class="text-sm text-on-surface">{{ t("renderVideo.fpsLabel") }}</span>
        <SRadioGroup :value="fps" @update:value="fps = $event as RenderVideoFps">
          <SRadio
            v-for="opt in fpsOptions"
            :key="opt.value"
            :value="opt.value"
            :label="opt.label"
          />
        </SRadioGroup>
      </div>

      <!-- 视频码率 -->
      <div class="flex flex-col gap-2">
        <div class="flex items-baseline justify-between">
          <span class="text-sm text-on-surface">{{ t("renderVideo.bitrateLabel") }}</span>
          <span class="text-xs text-on-surface-variant/70">
            {{ bitrateMbps === 0 ? t("renderVideo.bitrateAuto") : `${bitrateMbps} Mbps` }}
          </span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          <SButton
            v-for="preset in bitratePresets"
            :key="preset"
            size="small"
            :type="bitrateMbps === preset ? 'primary' : 'default'"
            :variant="bitrateMbps === preset ? 'secondary' : 'tertiary'"
            class="tabular-nums"
            @click="bitrateMbps = preset"
          >
            {{ preset === 0 ? t("renderVideo.bitrateAuto") : `${preset}M` }}
          </SButton>
        </div>
      </div>

      <!-- 输出目录 -->
      <div class="flex flex-col gap-2">
        <span class="text-sm text-on-surface">{{ t("renderVideo.outputDirLabel") }}</span>
        <div class="flex items-center gap-2">
          <SInput
            :model-value="outputDir"
            readonly
            class="flex-1"
            :placeholder="t('renderVideo.outputDirPlaceholder')"
          />
          <SButton variant="secondary" @click="onPickDir">
            <IconFolderOpen class="w-4 h-4" />
            <span>{{ t("renderVideo.browse") }}</span>
          </SButton>
          <SButton variant="tertiary" :disabled="!outputDir" @click="onOpenOutputDir">
            {{ t("renderVideo.openFolder") }}
          </SButton>
        </div>
      </div>

      <!-- 串接模式下渲染过渡动画 -->
      <div
        v-if="mode === 'merge'"
        class="flex items-center justify-between"
      >
        <div class="flex flex-col">
          <span class="text-sm text-on-surface">{{ t("renderVideo.transitionLabel") }}</span>
          <span class="text-xs text-on-surface-variant/70">
            {{ t("renderVideo.transitionTip") }}
          </span>
        </div>
        <SSwitch v-model="renderTransition" />
      </div>

      <!-- 当前任务进度（如有） -->
      <div v-if="hasActiveTask" class="flex flex-col gap-2">
        <span class="text-sm text-on-surface">{{ t("renderVideo.activeTasks") }}</span>
        <div class="flex flex-col gap-1.5 max-h-32 overflow-y-auto">
          <div
            v-for="task in tasks.filter((t) =>
              ['queued', 'rendering', 'muxing'].includes(t.status),
            )"
            :key="task.taskId"
            class="flex items-center gap-2 px-2 py-1.5 rounded bg-black/5 dark:bg-white/5 text-xs"
          >
            <IconLoader
              v-if="task.status === 'rendering' || task.status === 'muxing'"
              class="w-3.5 h-3.5 animate-spin text-primary shrink-0"
            />
            <IconCheck
              v-else-if="task.status === 'done'"
              class="w-3.5 h-3.5 text-green-500 shrink-0"
            />
            <IconX
              v-else-if="task.status === 'failed'"
              class="w-3.5 h-3.5 text-red-500 shrink-0"
            />
            <span class="flex-1 truncate text-on-surface">
              {{ task.filePath ?? statusText(task.status) }}
            </span>
            <span class="text-on-surface-variant/70 tabular-nums">
              {{ formatProgress(task) }}%
            </span>
            <SButton
              v-if="task.status !== 'done' && task.status !== 'failed'"
              size="small"
              variant="ghost"
              class="!px-1 !py-0.5 !h-6"
              @click="onCancelTask(task.taskId)"
            >
              {{ t("renderVideo.cancelTask") }}
            </SButton>
          </div>
        </div>
      </div>
    </div>

    <template #footer="{ close }">
      <SButton variant="tertiary" @click="close">{{ t("common.close") }}</SButton>
      <SButton
        type="primary"
        :disabled="isStarting || tracks.length === 0"
        @click="onStart"
      >
        <IconVideo class="w-4 h-4" />
        <span>{{ t("renderVideo.start") }}</span>
      </SButton>
    </template>
  </SDialog>
</template>
