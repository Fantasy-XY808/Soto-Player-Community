<script setup lang="ts">
/**
 * 居中专辑布局
 *
 * 特点：
 * - 专辑封面居中大显示，左右对称
 * - 歌词显示在封面下方（窄窗口）或封面上方（宽窗口）
 * - 歌曲信息在歌词下方
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
import AroundCoverSpectrum from "@/components/player/FullPlayer/AroundCoverSpectrum.vue";
import PureMusicComment from "@/components/player/FullPlayer/PureMusicComment.vue";
import PlayerCover from "@/components/player/FullPlayer/PlayerCover.vue";
import PlayerData from "@/components/player/FullPlayer/PlayerData.vue";
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

const isAroundSpectrum = computed(() => settings.player.spectrumStyle === "around");

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
    class="centered-album-layout absolute inset-0 text-cover"
    :class="[enhanceClass]"
    :style="{ '--lp-color': 'rgb(var(--s-cover))', ...autoStyleVars, ...spectrumStyleVars }"
  >
    <!-- 粒子背景 -->
    <RaindropBackground
      v-if="settings.player.enableRaindropBackground && !particleEffectsReduced"
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

    <!-- 底部频谱（避开封面与歌词） -->
    <BottomSpectrum
      v-if="settings.player.enableSpectrum && !isAroundSpectrum"
      :show="isPlaying"
      :height="50"
    />

    <!-- 主区域：封面居中 + 歌词下方
         Y 轴布局修正：
         - pt/pb 避让 FullPlayer 顶栏(h-12/h-14)和底栏(h-16/h-20)
         - 封面+歌曲信息用 my-auto 在剩余空间内垂直居中（独立子 flex 容器）
         - 歌词区 flex-1 占满下方剩余空间
         - 不再用 justify-center（flex-1 子元素存在时它失效，且会让封面贴顶）
         - 移除了封面外层多余的 rounded-2xl overflow-hidden shadow-2xl 包装 div
           （PlayerCover 内层已有 rounded-[32px] overflow-hidden shadow，包装层
            的 shadow-2xl 会在封面下沿形成"透明带边框圆角底"的视觉残留） -->
    <div class="absolute inset-0 flex flex-col items-center px-4 pt-12 md:pt-14 pb-16 md:pb-20">
      <!-- 封面 + 歌曲信息：作为一组在剩余空间内垂直居中 -->
      <div class="flex flex-col items-center my-auto">
        <!-- 居中封面（带环绕径向频谱） -->
        <div class="relative w-[clamp(220px,32vw,42vh)] shrink-0">
          <Transition :name="trackTransitionName" mode="out-in">
            <div :key="media.track?.id" class="relative">
              <PlayerCover />
              <AroundCoverSpectrum
                v-if="isAroundSpectrum && settings.player.enableSpectrum"
                :show="isPlaying"
              />
            </div>
          </Transition>
        </div>

        <!-- 歌曲信息（封面下方） -->
        <div class="mt-6 w-full max-w-[800px] text-center shrink-0">
          <PlayerData align="center" />
        </div>
      </div>

      <!-- 歌词区（歌曲信息下方，占满剩余高度） -->
      <div
        class="lyric-area relative w-full max-w-[1200px] flex-1 min-h-0 mt-4"
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

    <!-- 歌词侧边工具栏 -->
    <LyricActions :immersive="false" />
  </div>
</template>

<style scoped>
.centered-album-layout {
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
