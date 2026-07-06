<script setup lang="ts">
/**
 * 灵动岛背景风格
 * 参照 WinIsland 的 render.rs：
 * - solid：纯黑底
 * - glass/mica：backdrop-filter 模糊桌面 + 深色叠加层（提升前景对比）
 * - dynamic：Canvas 绘制封面 64x64 降采样放大模糊 + 慢速旋转（60s）+ sin/cos 双频漂移
 *
 * 深色叠加层统一为 .dark-overlay，所有非 solid 风格共用；dynamic 不再在 Canvas 内填黑
 * 运动模糊由 App.vue 根节点 filter:blur 统一施加，本组件不独立处理
 */
import type { IslandBackgroundStyle } from "@shared/types/settings";

interface Props {
  backgroundStyle?: IslandBackgroundStyle;
  coverSrc?: string;
}

const props = withDefaults(defineProps<Props>(), {
  backgroundStyle: "solid",
  coverSrc: "",
});

const driftRef = ref<HTMLElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);

let cacheValid = false;
let lastCoverSrc = "";
let coverImg: HTMLImageElement | null = null;
let canvasW = 0;
let canvasH = 0;

/* 漂移参数（参照 WinIsland：dx = sin(t*0.15)*20, dy = cos(t*0.12)*15） */
const DRIFT_AMP_X = 20;
const DRIFT_AMP_Y = 15;
const DRIFT_FREQ_X = 0.15;
const DRIFT_FREQ_Y = 0.12;
let driftRaf = 0;
let driftStart = 0;

const loadCoverImage = (src: string): Promise<HTMLImageElement | null> => {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
};

/** 绘制动态背景：封面 64x64 降采样再放大，自然产生模糊（参照 WinIsland） */
const drawDynamicBackground = async (): Promise<void> => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  if (!coverImg || props.coverSrc !== lastCoverSrc) {
    coverImg = await loadCoverImage(props.coverSrc);
    if (!coverImg) return;
    lastCoverSrc = props.coverSrc;
  }

  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w <= 0 || h <= 0) return;
  if (canvasW !== w || canvasH !== h) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvasW = w;
    canvasH = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  ctx.clearRect(0, 0, w, h);

  const tinySize = 64;
  const offscreen = document.createElement("canvas");
  offscreen.width = tinySize;
  offscreen.height = tinySize;
  const offCtx = offscreen.getContext("2d")!;
  offCtx.drawImage(coverImg, 0, 0, tinySize, tinySize);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "medium";
  ctx.drawImage(offscreen, 0, 0, w, h);

  cacheValid = true;
};

const render = async (): Promise<void> => {
  if (cacheValid) return;
  if (props.backgroundStyle === "solid") {
    cacheValid = true;
    return;
  }
  if (props.backgroundStyle === "dynamic") {
    await drawDynamicBackground();
  }
  cacheValid = true;
};

const invalidate = (): void => {
  cacheValid = false;
};

/** 漂移 RAF：sin/cos 双频漂移，仅 dynamic 风格启用 */
const tickDrift = (now: number): void => {
  if (driftStart === 0) driftStart = now;
  const t = (now - driftStart) / 1000;
  const dx = Math.sin(t * DRIFT_FREQ_X) * DRIFT_AMP_X;
  const dy = Math.cos(t * DRIFT_FREQ_Y) * DRIFT_AMP_Y;
  if (driftRef.value) {
    driftRef.value.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
  }
  driftRaf = requestAnimationFrame(tickDrift);
};

const startDrift = (): void => {
  if (driftRaf === 0 && props.backgroundStyle === "dynamic") {
    driftStart = 0;
    driftRaf = requestAnimationFrame(tickDrift);
  }
};

const stopDrift = (): void => {
  if (driftRaf !== 0) {
    cancelAnimationFrame(driftRaf);
    driftRaf = 0;
  }
};

const handleVisibilityChange = (): void => {
  if (document.hidden) stopDrift();
  else startDrift();
};

watch(
  () => props.backgroundStyle,
  (style) => {
    invalidate();
    render();
    if (style === "dynamic") startDrift();
    else stopDrift();
  },
);

watch(
  () => props.coverSrc,
  (newSrc) => {
    if (props.backgroundStyle === "dynamic" && newSrc !== lastCoverSrc) {
      invalidate();
      render();
    }
  },
);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  render();
  if (props.backgroundStyle === "dynamic") startDrift();
  document.addEventListener("visibilitychange", handleVisibilityChange);
  if (driftRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (props.backgroundStyle === "dynamic") {
        canvasW = 0;
        canvasH = 0;
        invalidate();
        render();
      }
    });
    resizeObserver.observe(driftRef.value);
  }
});

onBeforeUnmount(() => {
  stopDrift();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  resizeObserver?.disconnect();
  resizeObserver = null;
  cacheValid = false;
  coverImg = null;
});
</script>

<template>
  <div class="glass-bg" :class="[`style-${backgroundStyle}`]">
    <template v-if="backgroundStyle === 'glass'">
      <div class="glass-layer" />
      <div class="dark-overlay" />
    </template>
    <template v-else-if="backgroundStyle === 'mica'">
      <div class="mica-layer" />
      <div class="dark-overlay" />
    </template>
    <template v-else-if="backgroundStyle === 'dynamic'">
      <div ref="driftRef" class="dynamic-drift">
        <canvas ref="canvasRef" class="dynamic-layer" />
      </div>
      <div class="dark-overlay" />
    </template>
  </div>
</template>

<style scoped>
.glass-bg {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
  z-index: 0;
}
.glass-layer {
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(40px) saturate(1.5);
  -webkit-backdrop-filter: blur(40px) saturate(1.5);
}
.mica-layer {
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(80px) saturate(2);
  -webkit-backdrop-filter: blur(80px) saturate(2);
}
/* 漂移容器：扩展尺寸避免漂移时露出边缘 */
.dynamic-drift {
  position: absolute;
  inset: -25%;
  will-change: transform;
}
.dynamic-layer {
  width: 100%;
  height: 100%;
  /* 慢速旋转：60 秒一圈（参照 WinIsland） */
  animation: dynamic-rotate 60s linear infinite;
  will-change: transform;
}
@keyframes dynamic-rotate {
  from {
    transform: rotate(0deg) scale(1.3);
  }
  to {
    transform: rotate(360deg) scale(1.3);
  }
}
/* 深色叠加层：统一压暗非 solid 风格，保留前景文字对比 */
.dark-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
}
</style>
