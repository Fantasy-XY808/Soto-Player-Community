<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import { getCurrentTime } from "@/services/playback";
import type { QualityLevel } from "@/utils/quality";
import { useFavorite } from "@/composables/useFavorite";
import { useDownload, buildDownloadQualityItems } from "@/composables/useDownload";
import { usePlaylistPicker } from "@/composables/usePlaylistPicker";
import Lyrics from "@/components/player/Lyrics/index.vue";

import PlaylistPickerDialog from "@/components/modals/PlaylistPickerDialog.vue";
import CopyLyricsDialog from "@/components/modals/CopyLyricsDialog.vue";
import { useWindowControls } from "@/composables/useWindowControls";
import * as player from "@/core/player";
import { formatTime } from "@/utils/time";
import { openExternal } from "@/utils/url";
import IconFavorite from "~icons/material-symbols/favorite-rounded";
import IconFavoriteOutline from "~icons/material-symbols/favorite-outline-rounded";
import IconLucideListPlus from "~icons/lucide/list-plus";
import IconLucideDownload from "~icons/lucide/download";
import IconLucideMessageCircle from "~icons/lucide/message-circle";
import FluidBackground from "./FluidBackground.vue";
import SnowBackground from "./SnowBackground.vue";
import FogBackground from "./FogBackground.vue";
import RaindropBackground from "./RaindropBackground.vue";
import CoverDepthOfField from "./CoverDepthOfField.vue";
import AroundCoverSpectrum from "./AroundCoverSpectrum.vue";
import PureMusicComment from "./PureMusicComment.vue";
import CommentPanel from "./CommentPanel.vue";
import { usePaletteExtractor } from "@/composables/usePaletteExtractor";
import { useSongComments } from "@/composables/useSongComments";
import { isPureMusic } from "@shared/utils/pureMusicDetect";
import { toast } from "@/composables/useToast";

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();
const fav = useFavorite();

/** 封面调色板提取 */
const { dominant, palette, extract: extractPalette, reset: resetPalette } = usePaletteExtractor();

watch(
  () => media.track?.cover,
  (coverUrl) => {
    if (coverUrl) extractPalette(coverUrl);
    else resetPalette();
  },
  { immediate: true },
);
const { enqueue: enqueueDownload } = useDownload();
const { t } = useI18n();
const {
  isPlaying,
  isLoading,
  position,
  duration,
  isExpanded,
  repeatMode,
  shuffleMode,
  heartMode,
  fmMode,
  showLyric,
} = storeToRefs(status);

/** 歌词组件引用 */
const lyricRef = ref<InstanceType<typeof Lyrics>>();

/** 精确播放时间（毫秒）；offset 直接读 status mirror（主进程权威源） */
const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  if (!status.trackLoading && !media.lyricLoading) {
    lyricRef.value?.setCurrentTime(currentMs + status.lyricOffsetMs);
  }
});

/** 歌词组件是否已挂载 */
const lyricMounted = ref(false);
/** 初始播放时间 */
const initialLyricTimeMs = ref(0);

/** 歌词制作者 GitHub 主页（点击跳转） */
const authorGitHubUrl = computed(() => {
  const author = media.lyricAuthors[0];
  return author ? `https://github.com/${author}` : "";
});

/** 展开前 */
const onBeforeEnter = () => {
  if (lyricMounted.value) {
    // 先推一次当前时间
    lyricRef.value?.setCurrentTime(getCurrentTime() + status.lyricOffsetMs);
    lyricRef.value?.resume();
    startTick();
  }
};

/** 展开后 */
const onAfterEnter = () => {
  if (!lyricMounted.value) {
    initialLyricTimeMs.value = getCurrentTime() + status.lyricOffsetMs;
    lyricMounted.value = true;
    nextTick(() => {
      lyricRef.value?.resume();
      startTick();
    });
  }
};

/** 收起前：冻结歌词渲染 + 停止时钟 */
const onBeforeLeave = () => {
  lyricRef.value?.freeze();
  stopTick();
};

const hasTrack = computed(() => !!media.track);

/** 当前歌曲是否可下载 */
const canDownload = computed(
  () => !!media.track && media.track.source !== "local" && settings.system.download.enabled,
);

/** 下载音质菜单项 */
const downloadQualityItems = computed(() =>
  buildDownloadQualityItems(t("download.qualityDefault")),
);

/** 选择音质后下载（空 key 表示用设置中的默认音质） */
const onDownloadSelect = (key: string): void => {
  if (!media.track) return;
  void enqueueDownload(media.track, key ? { quality: key as QualityLevel } : {});
};

/** 当前曲目是否有可显示的歌词 */
const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);

/** 当前是否为纯音乐（不限音源；用于居中封面等通用判定） */
const isPureMusicAnySource = computed(() => !media.lyricLoading && isPureMusic(media.parsedLyric));

/** 是否有「可显示」的歌词：暂无歌词与纯音乐都视为无可显示，统一走居中/评论分支 */
const hasDisplayableLyric = computed(() => hasLyric.value && !isPureMusicAnySource.value);

/** 纯音乐热评；切歌时由 composable 拉取并选一条 */
const { activeComment, isPureMusicTrack, loadStatus, retry } = useSongComments();

/** 当前是否展示纯音乐热评（覆盖歌词区）；用户在设置中开关，与 autoCenterCover 互斥但热评优先
 * 不依赖 activeComment：拉到热评时显示热评，拉不到时由 PureMusicComment 显示 fallback 文案 */
const showPureMusicComment = computed(
  () => isPureMusicTrack.value && settings.player.showPureMusicComment,
);

/** 评论面板是否打开 */
const commentPanelOpen = ref(false);

/** 歌词卡片对话框是否打开（底栏 Toolbar 的"复制歌词"入口触发） */
const lyricCardOpen = ref(false);

/** 当前音源是否支持评论面板（仅网易云有评论 API） */
const commentSupported = computed(() => media.track?.source === "netease");

/** 评论按钮点击：支持时打开面板，不支持时弹 toast 提示 */
const onCommentClick = (): void => {
  if (commentSupported.value) {
    commentPanelOpen.value = true;
  } else {
    toast.info(t("comment.unsupportedSource"));
  }
};

// 评论面板与播放队列互斥：开一个自动关另一个
watch(commentPanelOpen, (open) => {
  if (open && status.fullQueueOpen) status.fullQueueOpen = false;
});
watch(
  () => status.fullQueueOpen,
  (open) => {
    if (open) commentPanelOpen.value = false;
  },
);

/** 是否启用扇形歌词 */
const enableFanLyrics = computed(() => settings.player.enableFanLyrics);

/** 频谱样式是否为环绕封面（径向频谱取代底部频谱） */
const isAroundSpectrum = computed(() => settings.player.spectrumStyle === "around");

// 重新挂载时，刷新初始时间
watch(hasLyric, (value) => {
  if (value && lyricMounted.value) {
    initialLyricTimeMs.value = getCurrentTime() + status.lyricOffsetMs;
  }
});

// 歌词变化时先推送精确时间
watch(
  () => media.parsedLyric,
  () => {
    lyricRef.value?.setCurrentTime(getCurrentTime() + status.lyricOffsetMs);
  },
);

/** 全屏 */
const { isFullscreen, toggleFullscreen } = useWindowControls();

/** 是否全屏封面 */
const fullscreenCover = computed(() => settings.player.coverLayout === "fullscreen");

/** 封面是否居中：用户主动隐藏歌词，或无可显示歌词（暂无歌词/纯音乐）且 autoCenterCover 启用；评论面板打开时强制不居中（让位给评论） */
const coverCentered = computed(() => {
  if (fullscreenCover.value || status.fullQueueOpen || commentPanelOpen.value) return false;
  if (!showLyric.value) return true;
  // 纯音乐热评展示时让位给热评
  if (showPureMusicComment.value) return false;
  return settings.player.autoCenterCover && !hasDisplayableLyric.value;
});

/** 弹簧配置 */
const springConfig = computed(() => ({
  mass: settings.lyric.springMass,
  damping: settings.lyric.springDamping,
  stiffness: settings.lyric.springStiffness,
}));

const collapse = (): void => {
  isExpanded.value = false;
};

const onSeekDragEnd = (value: number): void => {
  player.seek(value);
};

/** 沉浸模式闲置时间（ms） */
const IMMERSIVE_IDLE_MS = 3000;
/** 沉浸模式是否激活 */
const immersive = ref(false);
/** 鼠标是否悬停在顶栏或底栏 */
const barHovered = ref(false);
/** 闲置定时器 */
let idleTimer: ReturnType<typeof setTimeout> | undefined;

/** 沉浸模式是否启用 */
const immersiveEnabled = computed(() => settings.player.autoImmersive && isExpanded.value);

/** 激活沉浸模式 */
const armIdle = (): void => {
  clearTimeout(idleTimer);
  immersive.value = false;
  if (!immersiveEnabled.value) return;
  idleTimer = setTimeout(() => {
    if (!barHovered.value) immersive.value = true;
  }, IMMERSIVE_IDLE_MS);
};

/** 鼠标进入播放器区域 */
const onPlayerMouseEnter = (): void => armIdle();

/** 鼠标离开播放器区域 */
const onPlayerMouseLeave = (): void => {
  clearTimeout(idleTimer);
  if (immersiveEnabled.value) immersive.value = true;
};

/** 鼠标移动节流时间戳 */
let lastMoveAt = 0;
/** 鼠标移动节流间隔(ms),100ms 内的连续移动只触发一次 armIdle */
const MOVE_THROTTLE_MS = 100;
/** 鼠标移动:节流避免高频 mousemove 触发 clearTimeout/setTimeout 链 */
const onMainMove = (): void => {
  const now = performance.now();
  if (now - lastMoveAt < MOVE_THROTTLE_MS) return;
  lastMoveAt = now;
  if (!barHovered.value) armIdle();
};

/** 鼠标进入顶/底栏 */
const onBarEnter = (): void => {
  barHovered.value = true;
  clearTimeout(idleTimer);
  immersive.value = false;
};

/** 鼠标离开顶/底栏 */
const onBarLeave = (): void => {
  barHovered.value = false;
  armIdle();
};

watch(immersiveEnabled, (on) => {
  if (!on) {
    clearTimeout(idleTimer);
    immersive.value = false;
    barHovered.value = false;
  }
});

onBeforeUnmount(() => clearTimeout(idleTimer));

/** 添加到歌单 */
const {
  open: pickerOpen,
  tracks: pickerTracks,
  mode: pickerMode,
  openPicker,
} = usePlaylistPicker();

/** 歌词显隐按钮 */
const lyricToggleDisabled = computed(() => !hasLyric.value || fullscreenCover.value);
const lyricToggleActive = computed(
  () => showLyric.value && hasLyric.value && !status.fullQueueOpen && !fullscreenCover.value,
);

/** 切换歌词展示 */
const toggleLyric = (): void => {
  if (status.fullQueueOpen) {
    status.fullQueueOpen = false;
    showLyric.value = true;
  } else {
    showLyric.value = !showLyric.value;
  }
};
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      leave-active-class="transition-transform duration-500 ease-[cubic-bezier(0.7,0,0.3,1)]"
      enter-from-class="translate-y-full"
      leave-to-class="translate-y-full"
      @before-enter="onBeforeEnter"
      @after-enter="onAfterEnter"
      @before-leave="onBeforeLeave"
    >
      <div
        v-show="isExpanded"
        class="fixed inset-0 z-200 bg-surface overflow-hidden text-cover"
        :class="immersive ? 'cursor-none [&_*]:!cursor-none' : ''"
        style="--lp-color: rgb(var(--s-cover))"
        @mouseenter="onPlayerMouseEnter"
        @mouseleave="onPlayerMouseLeave"
      >
        <!-- 背景 -->
        <PlayerBackground />
        <!-- 封面景深：铺满整屏的模糊封面副本，低频驱动模糊深度 -->
        <CoverDepthOfField />
        <!-- 流体背景 -->
        <FluidBackground
          v-if="settings.player.enableFluidBackground"
          :dominant-color="dominant"
          :palette="palette"
        />
        <!-- 雪花背景层 -->
        <SnowBackground v-if="settings.player.enableSnowBackground" :palette="palette" />
        <!-- 雾气背景层 -->
        <FogBackground v-if="settings.player.enableFogBackground" :dominant-color="dominant" />
        <!-- 雨滴背景层 -->
        <RaindropBackground
          v-if="settings.player.enableRaindropBackground"
          :dominant-color="dominant"
        />
        <!-- 全屏封面 -->
        <div v-if="fullscreenCover" class="absolute inset-y-0 left-0 w-[60%]">
          <PlayerCover fullscreen />
        </div>
        <!-- 底部频谱（环绕模式下隐藏，改由 AroundCoverSpectrum 接管） -->
        <BottomSpectrum
          v-if="isExpanded && settings.player.enableSpectrum && !isAroundSpectrum"
          :show="isPlaying && immersive"
        />
        <!-- 顶/底栏渐变遮罩 -->
        <div
          v-if="fullscreenCover"
          class="cover-mask-top absolute top-0 inset-x-0 h-20 z-5 pointer-events-none transition-opacity duration-400"
          :class="immersive ? 'opacity-0' : 'opacity-100'"
        />
        <div
          v-if="fullscreenCover"
          class="cover-mask-bottom absolute bottom-0 inset-x-0 h-48 z-5 pointer-events-none transition-opacity duration-400"
          :class="immersive ? 'opacity-0' : 'opacity-100'"
        />
        <!-- 顶栏 -->
        <div
          class="absolute top-0 inset-x-0 h-14 z-10 app-drag-region transition-opacity duration-400 flex items-center justify-between px-3"
          :class="immersive ? 'opacity-0 pointer-events-none' : 'opacity-100'"
          @mouseenter="onBarEnter"
          @mouseleave="onBarLeave"
        >
          <div class="app-no-drag flex items-center gap-2">
            <SButton
              type="cover"
              variant="ghost"
              circle
              :size="40"
              :disabled="lyricToggleDisabled"
              :class="lyricToggleActive ? 'opacity-100' : 'opacity-40'"
              @click="toggleLyric"
            >
              <template #icon><IconLucideTextQuote /></template>
            </SButton>
            <SButton
              type="cover"
              variant="ghost"
              circle
              :size="40"
              :title="commentSupported ? t('comment.title') : t('comment.unsupportedSource')"
              :class="commentPanelOpen ? 'opacity-100' : 'opacity-40'"
              @click="onCommentClick"
            >
              <template #icon><IconLucideMessageCircle /></template>
            </SButton>
          </div>
          <div class="app-no-drag flex items-center gap-3">
            <SButton type="cover" variant="ghost" circle :size="40" @click="toggleFullscreen">
              <template #icon>
                <IconLucideMinimize v-if="isFullscreen" />
                <IconLucideMaximize v-else />
              </template>
            </SButton>
            <WindowControls cover />
          </div>
        </div>
        <!-- 主区域 -->
        <div class="absolute top-14 inset-x-0 bottom-20" @mousemove="onMainMove">
          <!-- 左侧 -->
          <div
            v-if="!fullscreenCover"
            class="absolute inset-y-0 left-0 w-[45%] flex items-center justify-center px-12 transition-transform duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
            :style="coverCentered ? 'transform: translateX(calc(100% * 11 / 18))' : undefined"
          >
            <!-- 封面 + 歌曲信息 -->
            <div class="relative w-[clamp(200px,85%,50vh)] -translate-y-[11vh]">
              <Transition name="scale-switch" mode="out-in">
                <div :key="media.track?.id">
                  <div class="relative">
                    <PlayerCover />
                    <!-- 环绕封面径向频谱 -->
                    <AroundCoverSpectrum
                      v-if="isAroundSpectrum && settings.player.enableSpectrum"
                      :show="isPlaying"
                    />
                  </div>
                  <!-- 歌曲信息 -->
                  <div class="absolute top-full left-0 w-full pt-6">
                    <PlayerData align="left" />
                  </div>
                </div>
              </Transition>
            </div>
          </div>
          <!-- 右侧 -->
          <div
            class="group absolute inset-y-0 right-0 pr-20 flex flex-col transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
            :class="[
              fullscreenCover ? 'w-1/2' : 'w-[55%]',
              coverCentered || status.fullQueueOpen || commentPanelOpen
                ? 'opacity-0 pointer-events-none'
                : 'opacity-100',
            ]"
          >
            <!-- 全屏封面 -->
            <div
              v-if="fullscreenCover"
              class="shrink-0 pt-2 pb-6 pl-[calc(1em-0.5rem)]"
              :style="{
                fontSize: settings.lyric.adaptiveFontSize
                  ? `calc(${settings.lyric.fontSize} / 1080 * 100vh)`
                  : `${settings.lyric.fontSize}px`,
              }"
            >
              <PlayerData align="left" simple />
            </div>
            <div
              class="lyric-area relative flex-1 min-h-0"
              :style="{
                fontSize: settings.lyric.adaptiveFontSize
                  ? `calc(${settings.lyric.fontSize} / 1080 * 100vh)`
                  : `${settings.lyric.fontSize}px`,
                fontWeight: String(settings.lyric.fontWeight),
                fontFamily: settings.lyric.fontFamily || undefined,
              }"
            >
              <Lyrics
                v-if="lyricMounted && hasLyric && !showPureMusicComment"
                ref="lyricRef"
                :lyric-lines="media.parsedLyric"
                :initial-time="initialLyricTimeMs"
                :playing="isPlaying"
                :align-position="settings.lyric.alignPosition"
                :word-fade-width="settings.lyric.wordFadeWidth"
                :spring-config="springConfig"
                :inactive-alpha="settings.lyric.inactiveAlpha"
                :hide-passed-lines="settings.lyric.hidePassedLines"
                :enable-blur="settings.lyric.enableBlur"
                :enable-word-highlight="settings.lyric.enableWordHighlight"
                :enable-float-animation="settings.lyric.enableFloatAnimation"
                :enable-emphasize-effect="settings.lyric.enableEmphasizeEffect"
                :show-translation="settings.lyric.showTranslation"
                :show-romanization="settings.lyric.showRomanization"
                :layout-mode="enableFanLyrics ? 'fan' : 'default'"
                :fan-angle="settings.player.fanLyricsAngle"
                :fan-max-visible-lines="settings.player.fanLyricsMaxLines"
                :fan-line-height="settings.player.fanLyricsLineHeight"
                :fan-min-scale="settings.player.fanLyricsMinScale"
                :fan-min-opacity="settings.player.fanLyricsMinOpacity"
                :fan-max-blur="settings.player.fanLyricsMaxBlur"
                :fan-enable-background="settings.player.fanLyricsEnableBackground"
                :fan-enable-glow="settings.player.fanLyricsEnableGlow"
                :lyric-scroll-direction="settings.lyric.lyricScrollDirection"
                @seek="player.seek($event)"
              >
                <template #bottom>
                  <div v-if="media.lyricAuthors[0]" class="lyric-credit-line">
                    {{ $t("player.lyricCredit") }}
                    <span
                      class="lp-content lyric-credit"
                      @click.stop="openExternal(authorGitHubUrl)"
                    >
                      {{ "@" + media.lyricAuthors[0] }}
                    </span>
                  </div>
                </template>
              </Lyrics>
              <PureMusicComment
                v-else-if="lyricMounted && showPureMusicComment"
                :comment="activeComment"
                :status="loadStatus"
                :on-retry="retry"
              />
              <div
                v-else-if="lyricMounted"
                class="w-full h-full flex items-center justify-center text-cover/30"
              >
                暂无歌词
              </div>
            </div>
            <!-- 歌词侧边工具栏 -->
            <LyricActions :immersive="immersive" />
          </div>
          <!-- 播放队列 -->
          <div
            class="absolute inset-y-0 right-0 pl-4 py-6 flex items-center"
            :class="[
              fullscreenCover ? 'w-1/2' : 'w-[55%]',
              status.fullQueueOpen || commentPanelOpen ? '' : 'pointer-events-none',
            ]"
          >
            <Transition
              enter-active-class="transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
              enter-from-class="opacity-0"
              leave-active-class="transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
              leave-to-class="opacity-0"
            >
              <div v-if="status.fullQueueOpen" class="w-full h-full">
                <QueuePanel @close="status.fullQueueOpen = false" />
              </div>
            </Transition>
            <Transition
              enter-active-class="transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
              enter-from-class="opacity-0"
              leave-active-class="transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
              leave-to-class="opacity-0"
            >
              <div v-if="commentPanelOpen" class="w-full h-full">
                <CommentPanel
                  :song-id="media.track?.id"
                  :song-title="media.track?.title"
                  @close="commentPanelOpen = false"
                />
              </div>
            </Transition>
          </div>
        </div>
        <!-- 底栏 -->
        <div
          class="absolute bottom-0 inset-x-0 h-20 z-10 flex items-center gap-4 px-4 transition-opacity duration-400"
          :class="immersive ? 'opacity-0 pointer-events-none' : 'opacity-100'"
          @mouseenter="onBarEnter"
          @mouseleave="onBarLeave"
        >
          <div class="flex-1 min-w-0 flex items-center justify-start gap-2">
            <SButton type="cover" variant="ghost" size="large" circle @click="collapse">
              <template #icon><IconLucideChevronDown /></template>
            </SButton>
            <SButton
              type="cover"
              variant="ghost"
              size="large"
              circle
              :disabled="!hasTrack"
              @click="fav.toggle(media.track)"
            >
              <template #icon>
                <IconFavorite v-if="fav.isLiked(media.track)" />
                <IconFavoriteOutline v-else />
              </template>
            </SButton>
            <SButton
              v-if="media.track?.source === 'local' || media.track?.source === 'netease'"
              type="cover"
              variant="ghost"
              size="large"
              circle
              @click="media.track && openPicker([media.track])"
            >
              <template #icon><IconLucideListPlus /></template>
            </SButton>
            <SDropdownMenu
              v-if="canDownload"
              :items="downloadQualityItems"
              cover
              side="top"
              align="start"
              @select="onDownloadSelect"
            >
              <template #trigger>
                <SButton type="cover" variant="ghost" size="large" circle>
                  <template #icon><IconLucideDownload /></template>
                </SButton>
              </template>
            </SDropdownMenu>
          </div>
          <div class="shrink-0 flex flex-col items-center gap-1 w-[clamp(360px,35%,480px)]">
            <div class="flex items-center gap-3">
              <SButton
                type="cover"
                variant="ghost"
                circle
                @click="
                  fmMode
                    ? player.dislikeFmTrack()
                    : heartMode
                      ? player.exitHeartMode()
                      : player.toggleShuffleMode()
                "
              >
                <template #icon>
                  <IconLucideHeartOff v-if="fmMode" />
                  <IconSpHeartMode v-else-if="heartMode" />
                  <IconLucideShuffle v-else-if="shuffleMode === 'on'" />
                  <IconSpPlayOrder v-else />
                </template>
              </SButton>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :disabled="!hasTrack || fmMode"
                @click="player.prevTrack()"
              >
                <template #icon><IconLucideSkipBack /></template>
              </SButton>
              <SButton
                type="cover"
                variant="secondary"
                size="large"
                circle
                :loading="isLoading"
                :disabled="!hasTrack && !isLoading"
                @click="player.togglePlay()"
              >
                <template #icon>
                  <IconLucidePause v-if="isPlaying" />
                  <IconLucidePlay v-else />
                </template>
              </SButton>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :disabled="!hasTrack"
                @click="player.nextTrack(true)"
              >
                <template #icon><IconLucideSkipForward /></template>
              </SButton>
              <SButton
                type="cover"
                variant="ghost"
                circle
                :disabled="fmMode"
                :class="fmMode || repeatMode === 'off' ? 'opacity-40' : 'opacity-100'"
                @click="player.cycleRepeatMode()"
              >
                <template #icon>
                  <IconLucideInfinity v-if="fmMode" />
                  <IconLucideRepeat1 v-else-if="repeatMode === 'one'" />
                  <IconLucideRepeat v-else />
                </template>
              </SButton>
            </div>
            <div class="flex items-center gap-2 w-full">
              <span class="text-xs text-cover/50 tabular-nums min-w-9 text-center">
                {{ formatTime(position) }}
              </span>
              <SSlider
                :model-value="position"
                :min="0"
                :max="duration"
                :step="100"
                :always-show-thumb="false"
                cover
                class="flex-1"
                @drag-end="onSeekDragEnd"
              />
              <span class="text-xs text-cover/50 tabular-nums min-w-9 text-center">
                {{ formatTime(duration) }}
              </span>
            </div>
          </div>
          <div class="flex-1 min-w-0 flex items-center justify-end">
            <Toolbar cover @open-comment="onCommentClick" @open-lyric-card="lyricCardOpen = true" />
          </div>
        </div>
      </div>
    </Transition>
    <PlaylistPickerDialog v-model:open="pickerOpen" :mode="pickerMode" :tracks="pickerTracks" />
    <CopyLyricsDialog v-model:open="lyricCardOpen" />
  </Teleport>
</template>

<style scoped>
.lyric-area {
  mask: linear-gradient(
    180deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 5%,
    #fff 10%,
    #fff 75%,
    hsla(0, 0%, 100%, 0.6) 85%,
    hsla(0, 0%, 100%, 0)
  );
}

/* 顶部/底部遮罩：多段非线性 alpha，避免暗色渐变出色阶 */
.cover-mask-top {
  background-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.5) 0%,
    rgba(0, 0, 0, 0.44) 12%,
    rgba(0, 0, 0, 0.36) 25%,
    rgba(0, 0, 0, 0.27) 40%,
    rgba(0, 0, 0, 0.18) 55%,
    rgba(0, 0, 0, 0.1) 70%,
    rgba(0, 0, 0, 0.04) 85%,
    rgba(0, 0, 0, 0) 100%
  );
}

.cover-mask-bottom {
  background-image: linear-gradient(
    to top,
    rgba(0, 0, 0, 0.5) 0%,
    rgba(0, 0, 0, 0.44) 12%,
    rgba(0, 0, 0, 0.36) 25%,
    rgba(0, 0, 0, 0.27) 40%,
    rgba(0, 0, 0, 0.18) 55%,
    rgba(0, 0, 0, 0.1) 70%,
    rgba(0, 0, 0, 0.04) 85%,
    rgba(0, 0, 0, 0) 100%
  );
}

.lyric-credit-line {
  font-size: max(0.5em, 10px);
}

.lyric-credit {
  margin-left: 0.5em;
}
</style>
