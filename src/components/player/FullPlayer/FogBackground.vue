<script setup lang="ts">
/**
 * 雾气背景层
 * 参照 BetterLyrics 的 FogRenderer,使用 Canvas 2D + 2 octave fbm 噪声绘制流动雾气
 * 低分辨率 offscreen 噪声拉伸放大,配合 CSS blur 形成柔和雾感;整体随节拍呼吸轻微放大
 */

import { useStatusStore } from "@/stores/status";
import { useBreathing } from "@/composables/useBreathing";

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface Props {
  dominantColor?: RGB | null;
}

const props = withDefaults(defineProps<Props>(), {
  dominantColor: null,
});

const status = useStatusStore();
const { scale } = useBreathing();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let rafId = 0;
let visible = true;
// 监听父元素尺寸变化,处理 FullPlayer v-show="isExpanded" 切换时 canvas 0×0 的问题
let resizeObserver: ResizeObserver | null = null;
/** RAF 节流间隔(ms),30fps 与后端 FFT 推送对齐,雾气慢速流动视觉无差异 */
const FRAME_INTERVAL = 32;
/** 上次绘制时间戳 */
let lastDrawTime = 0;
/**
 * 渲染缩放:canvas 实际像素 = CSS 像素 * RENDER_SCALE
 * blur(40px) 完全掩盖像素细节,0.5x 渲染省 75% 像素开销,视觉无差异
 */
const RENDER_SCALE = 0.5;

/** 噪声采样分辨率(低分辨率拉伸 + CSS blur 形成雾感) */
const NOISE_W = 128;
const NOISE_H = 72;
/** fbm 采样频率:越小越粗,越大越细 */
const NOISE_FREQ = 0.04;
/** 时间流动速度 */
const TIME_SPEED = 0.00004;

/** offscreen canvas 与 ImageData,模块级复用避免每帧分配 */
let offscreen: HTMLCanvasElement | null = null;
let offCtx: CanvasRenderingContext2D | null = null;
let offImageData: ImageData | null = null;

/** 整数哈希:位运算版,返回 0~1 */
const hash = (x: number, y: number): number => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** 平滑插值(平滑 Hermite 曲线) */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 2D value noise:四角哈希双线性插值 */
const valueNoise = (x: number, y: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = smooth(fx);
  const uy = smooth(fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};

/** 2 octave fbm:主频 + 双频细节,营造云雾层次 */
const fbm = (x: number, y: number): number => {
  return valueNoise(x, y) * 0.65 + valueNoise(x * 2.0, y * 2.0) * 0.35;
};

/** 初始化 offscreen canvas */
const initOffscreen = (): void => {
  offscreen = document.createElement("canvas");
  offscreen.width = NOISE_W;
  offscreen.height = NOISE_H;
  offCtx = offscreen.getContext("2d");
  if (offCtx) offImageData = offCtx.createImageData(NOISE_W, NOISE_H);
};

/** 绘制单帧(30fps 节流) */
const draw = (timestamp: number): void => {
  if (!visible) {
    rafId = 0;
    return;
  }
  // 30fps 节流
  if (timestamp - lastDrawTime < FRAME_INTERVAL) {
    rafId = requestAnimationFrame(draw);
    return;
  }
  lastDrawTime = timestamp;
  const canvas = canvasRef.value;
  if (!canvas) {
    rafId = 0;
    return;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx || !offCtx || !offscreen || !offImageData) {
    rafId = 0;
    return;
  }

  const w = canvas.width;
  const h = canvas.height;
  // 父元素 display:none 时尺寸为 0,跳过绘制但继续 RAF 等待可见
  if (w === 0 || h === 0) {
    rafId = requestAnimationFrame(draw);
    return;
  }
  ctx.clearRect(0, 0, w, h);

  // 节拍呼吸:scale > 1 时围绕中心放大
  const s = scale.value;
  const needScale = s > 1.001;
  if (needScale) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-w / 2, -h / 2);
  }

  const color = props.dominantColor ?? { r: 200, g: 200, b: 220 };
  const { r, g, b } = color;

  // 写入 fbm 到 offscreen ImageData,雾气浓度映射 alpha
  const data = offImageData.data;
  const t = timestamp * TIME_SPEED;
  for (let y = 0; y < NOISE_H; y++) {
    for (let x = 0; x < NOISE_W; x++) {
      // 流动方向:x 跟时间正向,y 略微错相
      const n = fbm(x * NOISE_FREQ + t, y * NOISE_FREQ + t * 0.7);
      // 提升对比度:中段以下压暗,营造云隙
      const alpha = Math.max(0, Math.min(255, Math.floor(Math.pow(n, 1.4) * 255)));
      const idx = (y * NOISE_W + x) * 4;
      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = alpha;
    }
  }
  offCtx.putImageData(offImageData, 0, 0);

  // 拉伸放大 + 屏幕混合,亮处叠加形成雾团
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(offscreen, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";

  if (needScale) ctx.restore();

  rafId = requestAnimationFrame(draw);
};

/** 调整 Canvas 尺寸:渲染缩放 0.5x,blur(40px) 掩盖像素细节 */
const resizeCanvas = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const cssW = parent.clientWidth;
  const cssH = parent.clientHeight;
  canvas.width = Math.max(1, Math.round(cssW * RENDER_SCALE));
  canvas.height = Math.max(1, Math.round(cssH * RENDER_SCALE));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
};

/**
 * 同步可见性:FullPlayer 收起 / 文档隐藏 / 暂停 时停止 RAF
 * 暂停时雾气静止可接受(节拍呼吸也停止),恢复时从下一帧继续
 */
const updateVisibility = (): void => {
  visible = !document.hidden && status.isExpanded && status.isPlaying;
  if (visible && !rafId) {
    lastDrawTime = 0;
    rafId = requestAnimationFrame(draw);
  } else if (!visible && rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
};

onMounted(() => {
  initOffscreen();
  resizeCanvas();
  // 父元素从 display:none 切换为可见时,clientWidth/Height 才会变为真实值
  resizeObserver = new ResizeObserver(() => resizeCanvas());
  if (canvasRef.value?.parentElement) {
    resizeObserver.observe(canvasRef.value.parentElement);
  }
  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", updateVisibility);
  // 展开/收起 + 播放/暂停切换时同步 RAF
  watch([() => status.isExpanded, () => status.isPlaying], updateVisibility);
  updateVisibility();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener("resize", resizeCanvas);
  document.removeEventListener("visibilitychange", updateVisibility);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  offscreen = null;
  offCtx = null;
  offImageData = null;
});
</script>

<template>
  <canvas ref="canvasRef" class="fog-background" />
</template>

<style scoped>
.fog-background {
  position: absolute;
  inset: 0;
  filter: blur(40px);
  pointer-events: none;
}
</style>
