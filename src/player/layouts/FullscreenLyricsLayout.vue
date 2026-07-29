<script setup lang="ts">
/**
 * 全屏歌词布局
 *
 * 特点：
 * - 歌词占满主区域中央，封面缩小到右上角作为装饰
 * - 歌词字号沿用用户设置；激活行居中显示
 * - 仍保留频谱、粒子背景、纯音乐热评分支
 * - 歌曲信息（标题/歌手）显示在歌词区上方，封面下方
 *
 * 通过 defineExpose 暴露与 ClassicLayout 相同的接口，容器可透明调用。
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
import * as player from "@/core/player";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import { toast } from "@/composables/useToast";
import { openExternal } from "@/utils/url";
import SnowBackground from "@/components/player/FullPlayer/SnowBackground.vue";
import FogBackground from "@/components/player/FullPlayer/FogBackground.vue";
import RaindropBackground from "@/components/player/FullPlayer/RaindropBackground.vue";
import PureMusicComment from "@/components/player/FullPlayer/PureMusicComment.vue";
import PlayerCover from "@/components/player/FullPlayer/PlayerCover.vue";
import BottomSpectrum from "@/components/player/FullPlayer/BottomSpectrum.vue";
import LyricActions from "@/components/player/FullPlayer/LyricActions.vue";

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();

const { enhanceClass, autoStyleVars } = useControlEnhance();

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
const { isPlaying } = storeToRefs(status);

const lyricRef = ref<InstanceType<typeof Lyrics>>();

const { start: startTick, stop: stopTick } = usePlaybackTime((currentMs) => {
  if (!status.trackLoading && !media.lyricLoading) {
    lyricRef.value?.setCurrentTime(currentMs + status.lyricOffsetMs);
  }
});

const lyricMounted = ref(false);
const initialLyricTimeMs = ref(0);

const authorGitHubUrl = computed(() => {
  const author = media.lyricAuthors[0];
  return author ? `https://github.com/${author}` : "";
});

const onBeforeEnter = (): void => {
  if (lyricMounted.value) {
    lyricRef.value?.setCurrentTime(getCurrentTime() + status.lyricOffsetMs);
    lyricRef.value?.resume();
    startTick();
  }
};

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

const onBeforeLeave = (): void => {
  lyricRef.value?.freeze();
  stopTick();
};

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

const hasLyric = computed(() => media.parsedLyric.length > 0 || media.lyricLoading);
const isPureMusicAnySource = computed(() => !media.lyricLoading && isPureMusic(media.parsedLyric));
const hasDisplayableLyric = computed(() => hasLyric.value && !isPureMusicAnySource.value);
const { activeComment, isPureMusicTrack, loadStatus, retry } = useSongComments();
const showPureMusicComment = computed(
  () => isPureMusicTrack.value && settings.player.showPureMusicComment,
);

const enableFanLyrics = computed(() => settings.player.enableFanLyrics);

/** 全屏歌词布局始终隐藏底部频谱（避免遮挡歌词）；可选启用环绕频谱仍由封面 PlayerCover 控制 */

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

watch(
  [hasLyric, () => media.parsedLyric],
  ([has], [prevHas]) => {
    if (has && prevHas !== has && lyricMounted.value) {
      initialLyricTimeMs.value = getCurrentTime() + status.lyricOffsetMs;
    }
    lyricRef.value?.setCurrentTime(getCurrentTime() + status.lyricOffsetMs);
  },
);

const { isPowerSaveMode } = usePowerSave();
const lyricAnimationReduced = computed(
  () =>
    isPowerSaveMode.value &&
    settings.system.system.powerSave.reduceItems.reduceLyricAnimation,
);
const particleEffectsReduced = computed(
  () =>
    isPowerSaveMode.value &&
    settings.system.system.powerSave.reduceItems.reduceParticleEffects,
);

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

const effectDowngradeActive = computed(
  () =>
    settings.player.enableEffectAutoDowngrade &&
    status.isExpanded &&
    (settings.player.enableFluidBackground || settings.player.enableFogBackground),
);
const { lowFpsCount, severeLowFpsCount, reset: resetFpsCooldown } = useFpsMonitor(
  effectDowngradeActive,
);

const userOverrodeDowngrade = ref(false);
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
    class="fullscreen-lyrics-layout absolute inset-0 text-cover"
    :class="[enhanceClass]"
    :style="{ '--lp-color': 'rgb(var(--s-cover))', ...autoStyleVars, ...spectrumStyleVars }"
  >
    <!-- 粒子背景：互斥挂载 -->
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

    <!-- 右上角小封面（点击展开后可隐藏，沉浸感更强） -->
    <div
      class="absolute top-2 right-3 md:top-4 md:right-6 z-5 pointer-events-none"
    >
      <div class="pointer-events-auto w-[clamp(80px,12vw,160px)]">
        <Transition :name="trackTransitionName" mode="out-in">
          <div :key="media.track?.id" class="rounded-xl overflow-hidden shadow-2xl">
            <PlayerCover />
          </div>
        </Transition>
      </div>
      <div class="mt-2 text-center text-sm text-cover/70 truncate">
        {{ media.track?.title }}
      </div>
    </div>

    <!-- 底部频谱（避开中央歌词区，置于底部边栏下方） -->
    <BottomSpectrum
      v-if="settings.player.enableSpectrum && settings.player.spectrumStyle !== 'around'"
      :show="isPlaying"
      :height="50"
    />

    <!-- 主区域：歌词占满 -->
    <div class="absolute inset-0 flex flex-col items-center justify-center px-4 md:px-8">
      <div
        class="lyric-area relative w-full max-w-[1400px] flex-1 min-h-0"
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
          :align-position="0.5"
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
            <div v-if="media.lyricAuthors[0]" class="lyric-credit-line truncate text-center">
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
    </div>

    <!-- 歌词侧边工具栏：浮动到右侧 -->
    <LyricActions :immersive="false" />
  </div>
</template>

<style scoped>
.fullscreen-lyrics-layout {
  contain: layout paint style;
}

.lyric-area {
  mask: linear-gradient(
    180deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 5%,
    #fff 10%,
    #fff 90%,
    hsla(0, 0%, 100%, 0.6) 95%,
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
