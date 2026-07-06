<script setup lang="ts">
/**
 * 灵动岛展开视图（绝对坐标布局，深度对齐 WinIsland music_view.rs）
 *
 * 布局（基于 600×200 内容区，scale 由 config.scale 缩放）：
 * - 封面：72×72，左上角 (36, 24)
 * - 标题/艺术家：x=124（封面右 16px），title_y=50，artist_y=72
 * - 进度条：y=114，左 68 / 右 532（time_w=36 + 4 间距）
 * - 时间标签：左 x=36 / 右 x=564，baseline=117.5
 * - 控制按钮：cx=300，cy=158.75，间距 75
 * - 频谱（纯音乐）：x=555，y=46
 *
 * 与 flex 布局相比，绝对坐标不会因窗口高度不足而挤压控件，
 * 只会像 WinIsland 一样被 clip 裁剪，保证控件本身完整。
 */
import type { Track } from "@shared/types/player";
import type { DynamicIslandSettings } from "@shared/types/settings";
import type { LyricLine } from "@shared/types/lyrics";
import IslandSpectrum from "./IslandSpectrum.vue";
import { extractPalette } from "../utils/palette";
import DEFAULT_COVER from "@/assets/images/song.jpg";

interface Props {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  config: DynamicIslandSettings;
  currentLine?: LyricLine | null;
  isInstrumental?: boolean;
  impulse?: (which: "view" | "hide", velocity: number) => void;
}

const props = withDefaults(defineProps<Props>(), {
  currentLine: null,
  isInstrumental: false,
  impulse: undefined,
});

const emit = defineEmits<{
  (e: "seek", positionMs: number): void;
  (e: "prev"): void;
  (e: "next"): void;
  (e: "toggle-play"): void;
  (e: "interact"): void;
}>();

/* 布局常量（对齐 WinIsland music_view.rs，按 600×200 内容区） */
const COVER_SIZE = 72;
const COVER_RADIUS = 14;
const PAD_X = 36;
const COVER_X = PAD_X;
const COVER_Y = 24;
const TEXT_X = COVER_X + COVER_SIZE + 16;
const TITLE_Y = COVER_Y + 26;
const ARTIST_Y = TITLE_Y + 22;
const BAR_Y = COVER_Y + COVER_SIZE + 18;
const BAR_LEFT = PAD_X + 32;
const BAR_RIGHT_OFFSET = PAD_X + 32;
const BTN_CY = BAR_Y + 42;
const PROGRESS_H = 5.5;
const PROGRESS_H_HOVER = 9;
const PROGRESS_HIT_H = 16;
const VIZ_X_OFFSET = 45;
const VIZ_Y = TITLE_Y - 4;
const INSTRUMENTAL_SPECTRUM_HEIGHT = 50;
const INSTRUMENTAL_SPECTRUM_WIDTH = 120;
const IMPULSE_PAUSE = 0.3;
const IMPULSE_SKIP = 0.6;

const progressHovered = ref(false);
const isDragging = ref(false);
const progressRef = ref<HTMLElement | null>(null);
const hoverT = ref(0);
let hoverRaf = 0;
const pauseT = ref(0);
let pauseRaf = 0;

const containerEl = ref<HTMLElement | null>(null);
const containerWidth = ref(600);

const formatTime = (ms: number): string => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const progressPercent = computed(() => {
  if (!props.duration) return 0;
  return Math.min(1, Math.max(0, props.position / props.duration));
});

const seekFromEvent = (event: MouseEvent): void => {
  const el = progressRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  emit("seek", ratio * props.duration);
};

const onProgressMouseDown = (event: MouseEvent): void => {
  isDragging.value = true;
  seekFromEvent(event);
  emit("interact");
};

const onProgressMouseMove = (event: MouseEvent): void => {
  if (!isDragging.value) return;
  seekFromEvent(event);
};

const onProgressMouseUp = (): void => {
  isDragging.value = false;
};

const handlePrev = (): void => {
  props.impulse?.("view", -IMPULSE_SKIP);
  emit("prev");
  emit("interact");
};
const handleNext = (): void => {
  props.impulse?.("view", IMPULSE_SKIP);
  emit("next");
  emit("interact");
};
const handleTogglePlay = (): void => {
  props.impulse?.("view", IMPULSE_PAUSE);
  emit("toggle-play");
  emit("interact");
};

const artistsText = computed(() => props.track?.artists?.map((a) => a.name).join(" / ") ?? "");

/* hover 平滑：lerp 0.18 */
const tickHover = (): void => {
  const target = progressHovered.value || isDragging.value ? 1 : 0;
  hoverT.value += (target - hoverT.value) * 0.18;
  if (Math.abs(target - hoverT.value) < 0.001) {
    hoverT.value = target;
    hoverRaf = 0;
    return;
  }
  hoverRaf = requestAnimationFrame(tickHover);
};

watch(
  () => progressHovered.value || isDragging.value,
  () => {
    if (hoverRaf === 0) hoverRaf = requestAnimationFrame(tickHover);
  },
);

/* 暂停态平滑：lerp 0.10 */
const tickPause = (): void => {
  const target = props.playing ? 1 : 0;
  pauseT.value += (target - pauseT.value) * 0.1;
  if (Math.abs(target - pauseT.value) < 0.001) {
    pauseT.value = target;
    pauseRaf = 0;
    return;
  }
  pauseRaf = requestAnimationFrame(tickPause);
};

watch(
  () => props.playing,
  () => {
    if (pauseRaf === 0) pauseRaf = requestAnimationFrame(tickPause);
  },
);

const progressBarHeight = computed(() => {
  const h = PROGRESS_H + (PROGRESS_H_HOVER - PROGRESS_H) * hoverT.value;
  return h.toFixed(2);
});

const timeAlpha = computed(() => 0.5 + 0.5 * hoverT.value);
const coverFilter = computed(() => `brightness(${(0.75 + 0.25 * pauseT.value).toFixed(3)})`);
const coverTransform = computed(() => `scale(${(0.85 + 0.15 * pauseT.value).toFixed(3)})`);

/* 容器尺寸观测：用于动态计算进度条与按钮的绝对位置 */
let resizeObserver: ResizeObserver | null = null;

const updateSize = (): void => {
  if (!containerEl.value) return;
  const rect = containerEl.value.getBoundingClientRect();
  containerWidth.value = rect.width;
};

/* 派生坐标（基于实际容器宽度，避免硬编码 600px 导致不同窗口宽度下控件错位） */
const barLeft = computed(() => BAR_LEFT);
const barRight = computed(() => containerWidth.value - BAR_RIGHT_OFFSET);
const barWidth = computed(() => Math.max(0, barRight.value - barLeft.value));
const btnCx = computed(() => Math.round(containerWidth.value / 2));
const vizX = computed(() => containerWidth.value - VIZ_X_OFFSET);

onMounted(() => {
  window.addEventListener("mouseup", onProgressMouseUp);
  window.addEventListener("mousemove", onProgressMouseMove);
  pauseT.value = props.playing ? 1 : 0;
  resizeObserver = new ResizeObserver(updateSize);
  if (containerEl.value) resizeObserver.observe(containerEl.value);
  updateSize();
});

onBeforeUnmount(() => {
  window.removeEventListener("mouseup", onProgressMouseUp);
  window.removeEventListener("mousemove", onProgressMouseMove);
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (hoverRaf !== 0) cancelAnimationFrame(hoverRaf);
  if (pauseRaf !== 0) cancelAnimationFrame(pauseRaf);
});

const palette = ref<string[]>([
  "rgba(255, 255, 255, 0.9)",
  "rgba(255, 255, 255, 0.5)",
  "rgba(255, 255, 255, 0.9)",
]);

watch(
  () => props.track?.cover,
  async (cover) => {
    palette.value = await extractPalette(cover || DEFAULT_COVER);
  },
  { immediate: true },
);
</script>

<template>
  <div ref="containerEl" class="expanded">
    <!-- 封面 -->
    <div
      class="cover-frame"
      :style="{
        left: `${COVER_X}px`,
        top: `${COVER_Y}px`,
        width: `${COVER_SIZE}px`,
        height: `${COVER_SIZE}px`,
        borderRadius: `${COVER_RADIUS}px`,
      }"
    >
      <img
        :src="track?.cover || DEFAULT_COVER"
        alt="cover"
        draggable="false"
        decoding="async"
        class="cover-img"
        :style="{ filter: coverFilter, transform: coverTransform }"
        @error="($event.target as HTMLImageElement).src = DEFAULT_COVER"
      />
    </div>

    <!-- 标题 + 艺术家 -->
    <div class="info-area" :style="{ left: `${TEXT_X}px`, top: `${COVER_Y}px` }">
      <div class="song-title" :style="{ top: `${TITLE_Y - COVER_Y}px` }">
        {{ track?.title ?? "未知曲目" }}
      </div>
      <div class="song-artist" :style="{ top: `${ARTIST_Y - COVER_Y}px` }">
        {{ artistsText || "未知艺术家" }}
      </div>
    </div>

    <!-- 频谱（纯音乐模式） -->
    <IslandSpectrum
      v-if="isInstrumental && config.showSpectrum"
      :width="INSTRUMENTAL_SPECTRUM_WIDTH"
      :height="INSTRUMENTAL_SPECTRUM_HEIGHT"
      :max-height="INSTRUMENTAL_SPECTRUM_HEIGHT"
      :bar-width="4"
      :bar-gap="3"
      :num-bands="40"
      :palette="palette"
      :playing="playing"
      :spectrum-style="config.spectrumStyle"
      class="lyric-spectrum"
      :style="{ left: `${vizX - INSTRUMENTAL_SPECTRUM_WIDTH}px`, top: `${VIZ_Y}px` }"
    />

    <!-- 进度条命中区 -->
    <div
      ref="progressRef"
      class="progress-track"
      :style="{
        left: `${barLeft}px`,
        top: `${BAR_Y - PROGRESS_HIT_H / 2}px`,
        width: `${barWidth}px`,
        height: `${PROGRESS_HIT_H}px`,
      }"
      @mousedown="onProgressMouseDown"
      @mouseenter="progressHovered = true"
      @mouseleave="progressHovered = false"
    >
      <div
        class="progress-bar"
        :style="{
          height: `${progressBarHeight}px`,
        }"
      >
        <div
          class="progress-fill"
          :style="{
            width: `${Math.max(parseFloat(progressBarHeight), progressPercent * 100)}%`,
          }"
        />
      </div>
    </div>

    <!-- 左时间标签 -->
    <span
      class="time time-left"
      :style="{ left: `${PAD_X}px`, top: `${BAR_Y - 5}px`, opacity: timeAlpha }"
    >
      {{ formatTime(position) }}
    </span>

    <!-- 右时间标签 -->
    <span
      class="time time-right"
      :style="{ right: `${PAD_X}px`, top: `${BAR_Y - 5}px`, opacity: timeAlpha }"
    >
      -{{ formatTime(duration - position) }}
    </span>

    <!-- 控制按钮 -->
    <div class="controls" :style="{ left: `${btnCx}px`, top: `${BTN_CY}px` }">
      <button class="ctrl-btn ctrl-prev" type="button" @click="handlePrev">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
        </svg>
      </button>
      <button class="ctrl-btn ctrl-play" type="button" @click="handleTogglePlay">
        <svg v-if="playing" width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
        </svg>
        <svg v-else width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
      <button class="ctrl-btn ctrl-next" type="button" @click="handleNext">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.expanded {
  position: absolute;
  inset: 0;
  z-index: 2;
  color: #fff;
  pointer-events: none;
  /* 不裁剪：让控件在窗口尺寸不足时仍按固定坐标渲染，由父级 content-layer 统一裁剪 */
  overflow: visible;
}
/* 所有子元素绝对定位，不依赖 flex 拉伸 */
.cover-frame {
  position: absolute;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
  will-change: filter, transform;
}
.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition:
    filter 0.05s linear,
    transform 0.05s linear;
  will-change: filter, transform;
}
.info-area {
  position: absolute;
  width: 240px;
  height: 72px;
  overflow: hidden;
}
.song-title,
.song-artist {
  position: absolute;
  left: 0;
  font-size: 15px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 240px;
  line-height: 1.2;
}
.song-title {
  font-weight: 700;
  color: #fff;
}
.song-artist {
  font-weight: 400;
  color: #fff;
  opacity: 0.6;
}
.lyric-spectrum {
  position: absolute;
}
/* 进度条命中区 */
.progress-track {
  position: absolute;
  cursor: pointer;
  display: flex;
  align-items: center;
  pointer-events: auto;
}
.progress-bar {
  width: 100%;
  background: rgba(255, 255, 255, 0.25);
  border-radius: var(--bar-h, 5.5px);
  overflow: hidden;
  display: flex;
  align-items: center;
}
.progress-fill {
  height: 100%;
  background: #fff;
  border-radius: inherit;
  transition: width 0.05s linear;
}
.time {
  position: absolute;
  font-size: 10px;
  color: #fff;
  font-variant-numeric: tabular-nums;
  font-weight: 400;
  pointer-events: none;
  line-height: 1;
  user-select: none;
}
.time-left {
  text-align: left;
}
.time-right {
  text-align: right;
}
/* 控制按钮：绝对定位中心点，按钮自身用 transform 居中 */
.controls {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 75px;
  transform: translate(-50%, -50%);
  pointer-events: auto;
}
.ctrl-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: #fff;
  cursor: pointer;
  pointer-events: auto;
  transition: opacity 0.15s;
  padding: 0;
}
.ctrl-btn:hover {
  opacity: 0.7;
}
.ctrl-btn:active {
  transform: scale(0.92);
}
.ctrl-play {
  width: 40px;
  height: 40px;
}
</style>
