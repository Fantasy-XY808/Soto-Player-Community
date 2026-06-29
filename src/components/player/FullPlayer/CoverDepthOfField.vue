<script setup lang="ts">
/**
 * 封面景深背景
 *
 * 参照 BetterLyrics 的 CoverBackgroundRenderer：
 *   - 把当前封面放大到铺满整个 FullPlayer 区域
 *   - 高斯模糊形成「景深」效果（背景失焦，前景封面保持锐利）
 *   - 低频能量同时驱动 blur 半径与 scale：低频越强，背景越模糊且轻微膨胀，
 *     营造「重低音推开景深」的听感
 *   - 切歌时旧封面 → 新封面 0.7s 交叉淡入（双缓冲层）
 *
 * 与 PlayerBackground 的「blur 模式」区别：
 *   - PlayerBackground.blur 是静态模糊封面背景（无 FFT 调制）
 *   - 本组件是动态景深层，叠加在 PlayerBackground 之上、内容之下，
 *     且仅在 coverDepthOfField 开关开启时挂载
 *
 * Hidden = silent：FullPlayer 收起 / 暂停 / 文档隐藏时停止 RAF 并释放 FFT
 */

import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { getFftFrame } from "@/services/playback";
import { acquireFft, releaseFft } from "@/services/fftCapture";
import { useBreathing } from "@/composables/useBreathing";
import DEFAULT_COVER from "@/assets/images/song.jpg";

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();
const { isPlaying, isExpanded } = storeToRefs(status);
/** 复用全局 breathing scale（attack 0.2 / decay 0.05），与 FluidBackground 等共享节拍感 */
const { scale: breathingScale } = useBreathing();

/**
 * 景深激活：仅在 FullPlayer 展开 + 播放中 + 开关开启时跑 RAF / FFT
 * 不再排斥 blur 背景模式——景深层有 FFT 动态调制（blur 半径随低频变化），
 * 与静态 blur 背景是不同效果，叠加有增益；用户如嫌 GPU 负担可手动关其一
 */
const dofActive = computed(
  () => settings.appearance.coverDepthOfField && isExpanded.value && isPlaying.value,
);

/** 景深层 DOM 引用，用于直接写 style 避免响应式开销 */
const dofEl = ref<HTMLDivElement | null>(null);

/** 低频段末端 bin（与 BottomSpectrum 一致：跳过前 8 个噪声 bin） */
const BASS_BIN_END = 16;
/** 模糊基础值（px）：保证背景始终处于失焦状态 */
const BLUR_BASE = 80;
/** 低频能量驱动的模糊增量上限（px）：低频越强模糊越深 */
const BLUR_BASS_RANGE = 40;
/** 低频能量指数平滑系数，越大越柔和 */
const BASS_SMOOTHING = 0.85;
/** scale 基础值（铺满 + 10% 安全边距），避免模糊后边缘漏出底色 */
const SCALE_BASE = 1.1;
/** 低频驱动的额外 scale 上限，与 breathingScale 上限对齐 */
const SCALE_BASS_RANGE = 0.08;
/** RAF 节流间隔(ms),30fps 与后端 FFT 推送对齐,避免 60fps 冗余 DOM 写 */
const FRAME_INTERVAL = 32;

/** 平滑后的低频能量（0~1） */
let smoothedBass = 0;
/** 上次 tick 时间戳,30fps 节流 */
let lastTickTime = 0;

/**
 * 景深 RAF：读取 FFT 低频段，同步驱动 blur + scale
 * 直接写 DOM style，不触发 Vue 响应式更新
 * 30fps 节流与后端 FFT 推送对齐
 */
const tick = (): void => {
  // 30fps 节流
  const now = performance.now();
  if (now - lastTickTime < FRAME_INTERVAL) return;
  lastTickTime = now;
  const el = dofEl.value;
  if (!el) return;
  if (!el.style.willChange) el.style.willChange = "transform, filter";
  const data = getFftFrame();
  const end = Math.min(BASS_BIN_END, data.length);
  let sum = 0;
  for (let i = 0; i < end; i++) sum += data[i] ?? 0;
  const bass = sum / end;
  smoothedBass = smoothedBass * BASS_SMOOTHING + bass * (1 - BASS_SMOOTHING);
  const bassClamped = Math.min(smoothedBass, 1);
  const blur = BLUR_BASE + bassClamped * BLUR_BASS_RANGE;
  // breathingScale 已经做过非对称 EMA，这里直接叠加；高频抖动已被上游平滑掉
  const scale = SCALE_BASE + (breathingScale.value - 1) + bassClamped * SCALE_BASS_RANGE;
  el.style.filter = `blur(${blur.toFixed(1)}px)`;
  el.style.transform = `scale(${scale.toFixed(4)})`;
};

const { resume, pause } = useRafFn(tick, { immediate: false });

/** FFT 引用计数持有标记，保证 acquire / release 严格配对 */
let fftAcquired = false;

/** 启动景深动画：acquire FFT + 提升 will-change + 启动 RAF */
const startDof = (): void => {
  if (!fftAcquired) {
    acquireFft();
    fftAcquired = true;
  }
  const el = dofEl.value;
  if (el) el.style.willChange = "transform, filter";
  resume();
};

/** 停止景深动画：暂停 RAF + 回收 will-change + 释放 FFT */
const stopDof = (): void => {
  pause();
  const el = dofEl.value;
  if (el) {
    el.style.willChange = "";
    el.style.filter = `blur(${BLUR_BASE}px)`;
    el.style.transform = `scale(${SCALE_BASE})`;
  }
  smoothedBass = 0;
  if (fftAcquired) {
    releaseFft();
    fftAcquired = false;
  }
};

// 激活态切换：FullPlayer 收起 / 暂停 / 开关关闭时停止 RAF，遵循 Hidden = silent
watch(
  dofActive,
  (active) => {
    if (active) startDof();
    else stopDof();
  },
  { immediate: true },
);

onBeforeUnmount(stopDof);

/**
 * 切歌时旧封面 → 新封面 crossfade
 * 双缓冲层：active 层当前可见，next 层先 decode 再淡入，旧层随后淡出
 */
const blurLayers = reactive([
  { src: media.track?.cover || DEFAULT_COVER, active: true },
  { src: "", active: false },
]);
let currentLayerIndex = 0;
let preloadImg: HTMLImageElement | null = null;
let switchToken = 0;

watch(
  () => media.track?.cover || media.track?.coverOriginal,
  (newCover) => {
    const token = ++switchToken;
    if (preloadImg) {
      preloadImg.src = "";
      preloadImg = null;
    }
    const targetCover = newCover || DEFAULT_COVER;
    if (blurLayers[currentLayerIndex].src === targetCover) return;
    const nextIndex = currentLayerIndex === 0 ? 1 : 0;
    const switchLayer = (src: string) => {
      if (token !== switchToken) return;
      preloadImg = null;
      blurLayers[nextIndex].src = src;
      nextTick(() => {
        if (token !== switchToken) return;
        requestAnimationFrame(() => {
          if (token !== switchToken) return;
          blurLayers[nextIndex].active = true;
          blurLayers[currentLayerIndex].active = false;
          currentLayerIndex = nextIndex;
        });
      });
    };
    const img = new Image();
    preloadImg = img;
    img.src = targetCover;
    img
      .decode()
      .then(() => switchLayer(targetCover))
      .catch(() => switchLayer(DEFAULT_COVER));
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  switchToken++;
  if (preloadImg) {
    preloadImg.src = "";
    preloadImg = null;
  }
  blurLayers[0].src = "";
  blurLayers[1].src = "";
});
</script>

<template>
  <div v-if="dofActive" ref="dofEl" class="cover-dof" aria-hidden="true">
    <img
      v-for="(layer, index) in blurLayers"
      :key="index"
      :src="layer.src"
      class="cover-dof-img"
      :class="{ active: layer.active }"
      decoding="async"
      alt=""
    />
  </div>
</template>

<style scoped>
/**
 * 景深层：铺满整个 FullPlayer，z-index 介于 PlayerBackground（-1）与内容（0+）之间
 * - transform: scale(1.1) 略微放大避免模糊后边缘漏出底色；RAF 会动态覆盖
 * - 默认 blur(80px) 由 RAF 动态写入覆盖
 * - opacity: 0.7 提高可见度（原 0.55 太透明，与 PlayerBackground.blur 重叠后难辨）
 * - z-index: 0 与主内容容器（z-auto）同级，DOM 顺序在主内容之前，
 *   主内容透明容器让景深透出，子元素（封面/歌词）作为前景遮挡景深是设计意图
 */
.cover-dof {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  transform: scale(1.1);
  filter: blur(80px);
  opacity: 0.7;
}

.cover-dof-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.7s ease-in-out;
}

.cover-dof-img.active {
  opacity: 1;
}
</style>
