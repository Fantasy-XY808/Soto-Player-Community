<script setup lang="ts">
/**
 * 经典布局：左右分栏（封面 + 歌词）
 *
 * 原 FullPlayer 主区域内容，现抽象为可替换的布局之一。
 * 容器（FullPlayer/index.vue）负责：
 * - Teleport / Transition（展开/收起动画）
 * - 背景层（PlayerBackground + 粒子）
 * - 顶栏（歌词/评论/全屏按钮）
 * - 底栏（播放控制 + Toolbar）
 * - 播放队列面板
 *
 * 布局组件只负责"主区域"——封面 + 歌词 + 歌曲信息 + 侧边工具栏。
 *
 * 通过 defineExpose 暴露：
 * - lyricRef：歌词组件实例（容器需要推送精确时间 + freeze/resume）
 * - hasLyric / hasDisplayableLyric / showPureMusicComment：状态用于容器决定按钮 disabled
 */
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { getCurrentTime } from "@/services/playback";
import Lyrics from "@/components/player/Lyrics/index.vue";
import { usePaletteExtractor } from "@/composables/usePaletteExtractor";
import { useFpsMonitor } from "@/composables/useFpsMonitor";
import { useSongComments } from "@/composables/useSongComments";
import { isPureMusic } from "@shared/utils/pureMusicDetect";
import { useControlEnhance } from "@/composables/useControlEnhance";
import { usePowerSave } from "@/composables/usePowerSave";
import { useViewport } from "@/composables/useViewport";
import { openExternal } from "@/utils/url";
import * as player from "@/core/player";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import { toast } from "@/composables/useToast";
import SnowBackground from "@/components/player/FullPlayer/SnowBackground.vue";
import FogBackground from "@/components/player/FullPlayer/FogBackground.vue";
import RaindropBackground from "@/components/player/FullPlayer/RaindropBackground.vue";
import AroundCoverSpectrum from "@/components/player/FullPlayer/AroundCoverSpectrum.vue";
import PureMusicComment from "@/components/player/FullPlayer/PureMusicComment.vue";
import PlayerCover from "@/components/player/FullPlayer/PlayerCover.vue";
import PlayerData from "@/components/player/FullPlayer/PlayerData.vue";
import BottomSpectrum from "@/components/player/FullPlayer/BottomSpectrum.vue";
import LyricActions from "@/components/player/FullPlayer/LyricActions.vue";

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();

/** 控件可见性增强 */
const { enhanceClass, autoStyleVars } = useControlEnhance();

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

const { t } = useI18n();
const { isPlaying, showLyric } = storeToRefs(status);

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

/**
 * 容器调用：展开前推送一次时间 + resume
 *  - 主窗口点击展开：容器先 onBeforeEnter → lyricMounted 已 true 时直接推送
 *  - 视频渲染窗口：isExpanded setup 即 true，容器在 onMounted 调用 mountLyricIfNeeded
 */
const onBeforeEnter = (): void => {
  if (lyricMounted.value) {
    lyricRef.value?.setCurrentTime(getCurrentTime() + status.lyricOffsetMs);
    lyricRef.value?.resume();
    startTick();
  }
};

/** 容器调用：展开后挂载歌词（首次） */
const onAfterEnter = (): void => {
  if (!lyricMounted.value) {
    initialLyricTimeMs.value = getCurrentTime() + status.lyricOffsetMs;
    lyricMounted.value = true;
    nextTick(() => {
      lyricRef.value?.resume();
      startTick();
    });
  }
};

/** 容器调用：收起前冻结歌词渲染 + 停止时钟 */
const onBeforeLeave = (): void => {
  lyricRef.value?.freeze();
  stopTick();
};

/** 容器调用：视频渲染窗口场景下绕过 Transition enter 钩子直接挂载歌词 */
const mountLyricIfNeeded = (): void => {
  if (!lyricMounted.value) {
    initialLyricTimeMs.value = getCurrentTime() + status.lyricOffsetMs;
    lyricMounted.value = true;
    nextTick(() => {
      lyricRef.value?.resume();
      startTick();
    });
  }
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

/** 是否启用扇形歌词 */
const enableFanLyrics = computed(() => settings.player.enableFanLyrics);

/** 频谱样式是否为环绕封面（径向频谱取代底部频谱） */
const isAroundSpectrum = computed(() => settings.player.spectrumStyle === "around");

/** 切歌过渡动画名 */
const trackTransitionName = computed(() => {
  switch (settings.player.trackTransitionStyle) {
    case "fade":
      return "track-fade";
    case "slide":
      return "track-slide";
    case "none":
      return "";
    case "scale":
    default:
      return "scale-switch";
  }
});

// 歌词状态变化：合并刷新初始时间 + 推送精确时间
watch(
  [hasLyric, () => media.parsedLyric],
  ([has], [prevHas]) => {
    if (has && prevHas !== has && lyricMounted.value) {
      initialLyricTimeMs.value = getCurrentTime() + status.lyricOffsetMs;
    }
    lyricRef.value?.setCurrentTime(getCurrentTime() + status.lyricOffsetMs);
  },
);

/** 视口尺寸（用于响应式布局切换：窄窗口/纵长比下改为上下堆叠） */
const { width: viewportWidth, isPortrait } = useViewport();
/** 窄窗口（<768px）或纵长比（isPortrait）：主区域改为上下堆叠（封面在上，歌词在下） */
const isStacked = computed(() => viewportWidth.value < 768 || isPortrait.value);

/** 是否全屏封面 */
const fullscreenCover = computed(() => settings.player.coverLayout === "fullscreen");

/** 封面是否居中：用户主动隐藏歌词，或无可显示歌词（暂无歌词/纯音乐）且 autoCenterCover 启用；评论面板打开时强制不居中（让位给评论） */
const coverCentered = computed(() => {
  if (fullscreenCover.value || status.fullQueueOpen || status.commentPanelOpen) return false;
  if (!showLyric.value) return true;
  if (showPureMusicComment.value) return false;
  return settings.player.autoCenterCover && !hasDisplayableLyric.value;
});

/** 镜像布局是否生效：居中状态强制不生效 */
const mirrorEffective = computed(
  () => settings.player.mirrorLayout && !coverCentered.value && !fullscreenCover.value,
);

/** 省电模式降级标志：综合用户设置 + 系统电源状态 */
const { isPowerSaveMode } = usePowerSave();
/** 省电模式是否禁用歌词弹簧动画 */
const lyricAnimationReduced = computed(
  () =>
    isPowerSaveMode.value &&
    settings.system.system.powerSave.reduceItems.reduceLyricAnimation,
);
/** 省电模式是否禁用粒子效果（雪花 / 雾气 / 雨滴） */
const particleEffectsReduced = computed(
  () =>
    isPowerSaveMode.value &&
    settings.system.system.powerSave.reduceItems.reduceParticleEffects,
);

/** 弹簧配置 */
const springConfig = computed(() => {
  if (lyricAnimationReduced.value) {
    return { mass: 0.001, damping: 1000, stiffness: 1000, soft: true };
  }
  return {
    mass: settings.lyric.springMass,
    damping: settings.lyric.springDamping,
    stiffness: settings.lyric.springStiffness,
  };
});

/** 频谱亮度/颜色 CSS 变量 */
const spectrumStyleVars = computed(() => {
  const brightness = settings.player.spectrumBrightness;
  return {
    "--spectrum-brightness": String(brightness),
    "--spectrum-saturate": "1",
    "--spectrum-color":
      settings.player.spectrumColorMode === "custom"
        ? settings.player.spectrumCustomColor
        : "rgb(var(--s-cover))",
  };
});

/** 特效自动降级：连续低帧率时关闭流体/雾气背景 */
const effectDowngradeActive = computed(
  () =>
    settings.player.enableEffectAutoDowngrade &&
    status.isExpanded &&
    (settings.player.enableFluidBackground || settings.player.enableFogBackground),
);
const { lowFpsCount, severeLowFpsCount, reset: resetFpsCooldown } = useFpsMonitor(
  effectDowngradeActive,
);

/** 用户手动重开后本会话不再自动降级 */
const userOverrodeDowngrade = ref(false);
/** 自动降级进行中标记，防止触发 manual watch 误判 */
let isAutoDowngrading = false;

watch(
  [lowFpsCount, severeLowFpsCount],
  ([low, severe], [prevLow, prevSevere]) => {
    if (!settings.player.enableEffectAutoDowngrade || userOverrodeDowngrade.value) return;
    if (low !== prevLow && low >= 3) {
      const closed: string[] = [];
      isAutoDowngrading = true;
      if (settings.player.enableFluidBackground) {
        settings.player.enableFluidBackground = false;
        closed.push(t("settings.enableFluidBackground.label"));
      }
      if (settings.player.enableFogBackground) {
        settings.player.enableFogBackground = false;
        closed.push(t("settings.enableFogBackground.label"));
      }
      void nextTick(() => {
        isAutoDowngrading = false;
      });
      if (closed.length > 0) {
        toast.warning(t("player.effectAutoDowngradeToast", { effects: closed.join("、") }));
      }
    }
    if (severe !== prevSevere && severe >= 5 && settings.player.enableFluidBackground) {
      isAutoDowngrading = true;
      settings.player.enableFluidBackground = false;
      void nextTick(() => {
        isAutoDowngrading = false;
      });
      toast.warning(
        t("player.effectAutoDowngradeToast", { effects: t("settings.enableFluidBackground.label") }),
      );
    }
  },
);

watch(
  () =>
    [
      settings.player.enableFluidBackground,
      settings.player.enableFogBackground,
    ] as const,
  (next, prev) => {
    if (isAutoDowngrading) return;
    const turnedOn = next.some((v, i) => v && !prev[i]);
    if (turnedOn) {
      userOverrodeDowngrade.value = true;
      resetFpsCooldown();
    }
  },
);

/** 暴露给容器：歌词组件引用 + 状态 + 生命周期钩子 */
defineExpose({
  lyricRef,
  lyricMounted,
  hasLyric,
  hasDisplayableLyric,
  showPureMusicComment,
  isPureMusicTrack,
  onBeforeEnter,
  onAfterEnter,
  onBeforeLeave,
  mountLyricIfNeeded,
});
</script>

<template>
  <div
    class="classic-layout absolute inset-0 text-cover"
    :class="[enhanceClass]"
    :style="{ '--lp-color': 'rgb(var(--s-cover))', ...autoStyleVars, ...spectrumStyleVars }"
  >
    <!-- 粒子背景：互斥挂载，至多一个；流体背景开启时不挂载粒子层
         （流体本身已是动态背景，二者叠加会让主线程同时承载 5 层 RAF，
          是 FullPlayer 卡顿的主因） -->
    <RaindropBackground
      v-if="
        settings.player.enableRaindropBackground &&
        !particleEffectsReduced &&
        !settings.player.enableFluidBackground
      "
      :dominant-color="dominant"
    />
    <FogBackground
      v-else-if="
        settings.player.enableFogBackground &&
        !particleEffectsReduced &&
        !settings.player.enableFluidBackground
      "
      :dominant-color="dominant"
    />
    <SnowBackground
      v-else-if="
        settings.player.enableSnowBackground &&
        !particleEffectsReduced &&
        !settings.player.enableFluidBackground
      "
      :palette="palette"
    />
    <!-- 全屏封面 -->
    <div v-if="fullscreenCover" class="absolute inset-y-0 left-0 w-[60%]">
      <PlayerCover fullscreen />
    </div>
    <!-- 底部频谱（环绕模式下隐藏，改由 AroundCoverSpectrum 接管） -->
    <BottomSpectrum
      v-if="settings.player.enableSpectrum && !isAroundSpectrum"
      :show="isPlaying"
    />
    <!-- 主区域 -->
    <div class="absolute inset-0">
      <!-- 左侧（镜像时位于右侧） -->
      <div
        v-if="!fullscreenCover"
        class="absolute flex items-center justify-center transition-transform duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
        :class="
          isStacked
            ? 'top-0 inset-x-0 h-1/2 w-full px-4'
            : [
                'inset-y-0 md:w-[38%] px-4 md:px-8 lg:px-12',
                mirrorEffective ? 'right-0' : 'left-0',
              ]
        "
        :style="
          coverCentered && !isStacked
            ? {
                transform: mirrorEffective
                  ? 'translateX(calc(-100% * 31 / 38))'
                  : 'translateX(calc(100% * 31 / 38))',
              }
            : undefined
        "
      >
        <!-- 封面 + 歌曲信息 -->
        <div
          class="relative -translate-y-[11vh]"
          :class="isStacked ? 'w-[clamp(160px,60vw,42vh)]' : 'w-[clamp(160px,60vw,50vh)]'"
        >
          <Transition :name="trackTransitionName" mode="out-in">
            <div :key="media.track?.id">
              <div class="relative">
                <PlayerCover />
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
      <!-- 右侧（镜像时位于左侧） -->
      <div
        class="group absolute flex flex-col transition-opacity duration-600 ease-[cubic-bezier(0.4,0,0.2,1)]"
        :class="[
          isStacked
            ? 'bottom-0 inset-x-0 h-1/2 w-full px-4'
            : [
                'inset-y-0',
                fullscreenCover ? 'w-1/2' : 'md:w-[62%]',
                mirrorEffective ? 'left-0 pl-4 md:pl-8 lg:pl-12' : 'right-0 pr-4 md:pr-8 lg:pr-12',
              ],
          coverCentered || status.fullQueueOpen || status.commentPanelOpen
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
            :multi-line-highlight="settings.lyric.multiLineHighlight"
            :multi-line-count="settings.lyric.multiLineCount"
            :enable-blur="settings.lyric.enableBlur"
            :enable-word-highlight="settings.lyric.enableWordHighlight"
            :enable-float-animation="settings.lyric.enableFloatAnimation"
            :enable-emphasize-effect="settings.lyric.enableEmphasizeEffect"
            :show-translation="settings.lyric.showTranslation"
            :show-romanization="settings.lyric.showRomanization"
            :show-multi-voice="settings.lyric.showMultiVoice"
            :layout-mode="enableFanLyrics ? 'fan' : 'default'"
            :fan-angle="settings.player.fanLyricsAngle"
            :fan-max-visible-lines="settings.player.fanLyricsMaxLines"
            :fan-line-height="settings.player.fanLyricsLineHeight"
            :fan-min-scale="settings.player.fanLyricsMinScale"
            :fan-min-opacity="settings.player.fanLyricsMinOpacity"
            :fan-max-blur="settings.player.fanLyricsMaxBlur"
            :fan-enable-background="settings.player.fanLyricsEnableBackground"
            :fan-always-show-active-bg="settings.player.fanLyricsAlwaysShowActiveBg"
            :fan-enable-glow="settings.player.fanLyricsEnableGlow"
            :fan-scroll-display-mode="settings.player.fanLyricsScrollDisplayMode"
            :fan-sub-line-direction="settings.player.fanSubLineDirection"
            :fan-sub-line-animation-type="settings.player.fanSubLineAnimationType"
            :fan-sub-line-duration="settings.player.fanSubLineDuration"
            :fan-sub-line-delay="settings.player.fanSubLineDelay"
            :fan-sub-line-easing="settings.player.fanSubLineEasing"
            :fan-sub-line-cubic-bezier="settings.player.fanSubLineCubicBezier"
            :fan-sub-line-font-size="settings.player.fanSubLineFontSize"
            :fan-sub-line-opacity="settings.player.fanSubLineOpacity"
            :fan-sub-line-font-color="settings.player.fanSubLineFontColor"
            :fan-sub-line-font-style="settings.player.fanSubLineFontStyle"
            :fan-sub-line-font-weight="settings.player.fanSubLineFontWeight"
            :lyric-scroll-direction="settings.lyric.lyricScrollDirection"
            @seek="player.seek($event)"
          >
            <template #bottom>
              <div v-if="media.lyricAuthors[0]" class="lyric-credit-line truncate">
                {{ $t("player.lyricCredit") }}
                <span
                  class="lp-content lyric-credit truncate"
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
            class="w-full h-full flex items-center justify-center text-cover/30 truncate"
          >
            暂无歌词
          </div>
        </div>
        <!-- 歌词侧边工具栏 -->
        <LyricActions :immersive="false" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.classic-layout {
  /* 隔离布局/绘制/样式计算 */
  contain: layout paint style;
}

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

.lyric-credit-line {
  font-size: max(0.5em, 10px);
}

.lyric-credit {
  margin-left: 0.5em;
}
</style>
