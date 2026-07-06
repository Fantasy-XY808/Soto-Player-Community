<script setup lang="ts">
/**
 * 流体背景 — Canvas 2D 实现
 *
 * 原 FluidBackground 的 Canvas 2D + CSS blur 近似实现,WebGL 不可用时的 fallback。
 * 参照 BetterLyrics 的 FluidBackgroundEffect HLSL 着色器:
 * - 6 色块径向渐变 + lighter 混合(原 4 色升级,层次更丰富)
 * - HSV 色彩混合:同色相内插值,避免 RGB 直接 lerp 时的灰浊过渡
 * - 光波(LightWave):高频微纹波,提升"流动感"
 * - 抖动(Dithering):消除大片渐变的色带,肉眼更平滑
 * - 节拍呼吸:scale > 1 时围绕中心放大,与 BetterLyrics 的 bass energy 推动一致
 */

import { useStatusStore } from "@/stores/status";
import { useBreathing } from "@/composables/useBreathing";
import { subscribeRaf } from "@/services/rafScheduler";

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface Props {
  dominantColor?: RGB | null;
  palette?: RGB[];
}

const props = withDefaults(defineProps<Props>(), {
  dominantColor: null,
  palette: () => [],
});

const status = useStatusStore();
const { scale } = useBreathing();

const canvasRef = ref<HTMLCanvasElement | null>(null);
/** 当前订阅取消函数；非空表示正在订阅共享 RAF */
let unsubscribe: (() => void) | null = null;
// 监听父元素尺寸变化,处理 FullPlayer v-show="isExpanded" 切换时 canvas 0×0 的问题
let resizeObserver: ResizeObserver | null = null;
/** 调色板/主色最近变化时间戳(ms),用于静止判定 */
let lastPaletteChangeAt = 0;
/** 节拍呼吸最近活跃时间戳(ms),scale 偏离 1.0 时刷新 */
let lastBreathActiveAt = 0;
/** RAF 节流间隔(ms),20fps 足够流体效果,blur(60px) 掩盖帧间差异 */
const FRAME_INTERVAL = 50;
/**
 * 渲染缩放:canvas 实际像素 = CSS 像素 * RENDER_SCALE
 * blur(60px) 完全掩盖像素细节,0.4x 渲染省 84% 像素开销,视觉无差异
 */
const RENDER_SCALE = 0.4;
/** 静止判定阈值(ms):调色板与节拍呼吸均无显著变化超过此时长后,跳过重绘 */
const SETTLE_DELAY_MS = 800;
/** 节拍呼吸稳定阈值:scale 偏离 1.0 在此范围内视为静止 */
const BREATH_EPSILON = 0.005;

/** 色块定义 */
interface Blob {
  x: number;
  y: number;
  radius: number;
  color: RGB;
  speedX: number;
  speedY: number;
  phaseX: number;
  phaseY: number;
  /** 旋转角速度,用于色块在画布上做圆周漂移 */
  drift: number;
}

const blobs = shallowRef<Blob[]>([]);

/** RGB → HSV */
const rgbToHsv = (r: number, g: number, b: number): [number, number, number] => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
};

/** HSV → RGB */
const hsvToRgb = (h: number, s: number, v: number): RGB => {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
};

/** HSV 空间插值两色,避免 RGB lerp 的灰浊过渡 */
const lerpHsv = (a: RGB, b: RGB, t: number): RGB => {
  const [h1, s1, v1] = rgbToHsv(a.r, a.g, a.b);
  const [h2, s2, v2] = rgbToHsv(b.r, b.g, b.b);
  // 色相按最短弧插值
  let dh = h2 - h1;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const h = (h1 + dh * t + 360) % 360;
  const s = s1 + (s2 - s1) * t;
  const v = v1 + (v2 - v1) * t;
  return hsvToRgb(h, s, v);
};

/**
 * 生成 4 个色块:基于 palette 取前 2 色插值,保持色相一致性
 * 原 6 色降为 4 色,减少 33% 径向渐变创建+填充开销,blur(60px) 后视觉无差异
 */
const buildBlobColors = (): RGB[] => {
  const pal = props.palette.length >= 2 ? props.palette.slice(0, 2) : [];
  if (pal.length >= 2) {
    return [pal[0], lerpHsv(pal[0], pal[1], 0.33), lerpHsv(pal[0], pal[1], 0.66), pal[1]];
  }
  if (props.dominantColor) {
    // 单主色:派生 6 个色相偏移变体
    const [h, s, v] = rgbToHsv(props.dominantColor.r, props.dominantColor.g, props.dominantColor.b);
    return Array.from({ length: 4 }, (_, i) => {
      const dh = (i - 1.5) * 22; // ±33° 色相分散
      return hsvToRgb((h + dh + 360) % 360, Math.min(1, s + 0.1), Math.min(1, v + 0.05));
    });
  }
  // 兜底:深紫蓝调
  return [
    { r: 120, g: 80, b: 160 },
    { r: 80, g: 120, b: 200 },
    { r: 160, g: 80, b: 120 },
    { r: 100, g: 140, b: 180 },
  ];
};

/** 初始化色块 */
const initBlobs = (): void => {
  const colors = buildBlobColors();
const result: Blob[] = colors.map((color, i) => ({
    x: 0.15 + i / colors.length + (Math.random() - 0.5) * 0.2,
    y: 0.2 + Math.random() * 0.6,
    radius: 0.35 + Math.random() * 0.2,
    color,
    speedX: 0.0005 + Math.random() * 0.0008,
    speedY: 0.0005 + Math.random() * 0.0008,
    phaseX: i * 1.7 + Math.random(),
    phaseY: i * 2.3 + Math.random(),
    drift: (Math.random() - 0.5) * 0.0004,
  }));
  blobs.value = result;
};

/**
 * 抖动:在像素上叠加 ±1 的 RGB 抖动,消除大片渐变的色带
 * BetterLyrics 的 ScreenSpaceDither 在 HLSL 中做,Canvas 2D 用 imageData 后处理成本太高
 * 此处只在最终合成后做一次轻量抖动:用预生成的噪点纹理平铺,代替每帧数千次 fillRect
 */
let noiseCanvasWhite: HTMLCanvasElement | null = null;
let noiseCanvasBlack: HTMLCanvasElement | null = null;
/** 预生成 128x128 白/黑噪点纹理,每像素 50% 概率点亮,其他透明 */
const buildNoiseTextures = (): void => {
  const size = 128;
  // 白色噪点
  noiseCanvasWhite = document.createElement("canvas");
  noiseCanvasWhite.width = size;
  noiseCanvasWhite.height = size;
  const ctxW = noiseCanvasWhite.getContext("2d")!;
  const imgW = ctxW.createImageData(size, size);
  for (let i = 0; i < imgW.data.length; i += 4) {
    if (Math.random() < 0.5) {
      imgW.data[i] = 255;
      imgW.data[i + 1] = 255;
      imgW.data[i + 2] = 255;
      imgW.data[i + 3] = 255;
    }
    // 否则透明（alpha=0）
  }
  ctxW.putImageData(imgW, 0, 0);
  // 黑色噪点
  noiseCanvasBlack = document.createElement("canvas");
  noiseCanvasBlack.width = size;
  noiseCanvasBlack.height = size;
  const ctxB = noiseCanvasBlack.getContext("2d")!;
  const imgB = ctxB.createImageData(size, size);
  for (let i = 0; i < imgB.data.length; i += 4) {
    if (Math.random() < 0.5) {
      imgB.data[i] = 0;
      imgB.data[i + 1] = 0;
      imgB.data[i + 2] = 0;
      imgB.data[i + 3] = 255;
    }
  }
  ctxB.putImageData(imgB, 0, 0);
};
const applyDither = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
  if (!noiseCanvasWhite || !noiseCanvasBlack) return;
  // 白色噪点:globalAlpha 0.015 与原 rgba(255,255,255,0.015) 等价
  ctx.globalAlpha = 0.015;
  const patternW = ctx.createPattern(noiseCanvasWhite, "repeat");
  if (patternW) {
    ctx.fillStyle = patternW;
    ctx.fillRect(0, 0, w, h);
  }
  // 黑色噪点:globalAlpha 8/255 与原 rgba(0,0,0,8/255) 等价
  ctx.globalAlpha = 8 / 255;
  const patternB = ctx.createPattern(noiseCanvasBlack, "repeat");
  if (patternB) {
    ctx.fillStyle = patternB;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalAlpha = 1;
};

/** 绘制帧 */
const draw = (timestamp: number): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  // 父元素 display:none 时尺寸为 0,跳过绘制
  if (w === 0 || h === 0) return;

  // 节拍呼吸活跃判定:scale 偏离 1.0 时刷新 lastBreathActiveAt
  // 必须在静止优化之前,确保节拍来时立即恢复重绘
  const s = scale.value;
  if (Math.abs(s - 1) > BREATH_EPSILON) {
    lastBreathActiveAt = timestamp;
  }

  // 静止优化:调色板与节拍呼吸均长时间无显著变化时跳过重绘
  // 流体动画极慢,blur(48px) 后视觉无差异,持续重绘纯属空转
  if (timestamp - Math.max(lastPaletteChangeAt, lastBreathActiveAt) > SETTLE_DELAY_MS) return;

  // 节拍呼吸:scale > 1 时围绕中心放大
  const needScale = s > 1.001;
  if (needScale) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-w / 2, -h / 2);
  }

  // 深底色:取主色暗化,避免纯黑显得发闷
  const baseColor = props.dominantColor ?? { r: 18, g: 18, b: 22 };
  const baseR = Math.max(12, Math.floor(baseColor.r * 0.2));
  const baseG = Math.max(12, Math.floor(baseColor.g * 0.2));
  const baseB = Math.max(14, Math.floor(baseColor.b * 0.2));
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
  ctx.fillRect(0, 0, w, h);

  // 绘制色块:6 个径向渐变 + lighter 混合
  // 优化：只填充色块 bounding box 区域，而非全屏 fillRect
  const currentBlobs = blobs.value;
  ctx.globalCompositeOperation = "lighter";
  for (const blob of currentBlobs) {
    // 圆周漂移:色块在画布上沿小圆轨迹移动,避免长期停留在同位置
    const driftX = Math.sin(timestamp * blob.drift) * 0.05;
    const driftY = Math.cos(timestamp * blob.drift) * 0.05;
    const bx = (blob.x + Math.sin(timestamp * blob.speedX + blob.phaseX) * 0.25 + driftX) * w;
    const by = (blob.y + Math.cos(timestamp * blob.speedY + blob.phaseY) * 0.25 + driftY) * h;
    const br = blob.radius * Math.min(w, h);

    const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    const { r, g, b } = blob.color;
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.7)`);
    gradient.addColorStop(0.35, `rgba(${r}, ${g}, ${b}, 0.35)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    // 只填充色块 bounding box，而非全屏 fillRect(0,0,w,h)
    const bbX = Math.max(0, bx - br);
    const bbY = Math.max(0, by - br);
    const bbW = Math.min(w, bx + br) - bbX;
    const bbH = Math.min(h, by + br) - bbY;
    ctx.fillRect(bbX, bbY, bbW, bbH);
  }

  // 光波:沿对角线的高频亮纹,提升"流动感"
  // 模拟 BetterLyrics FluidBackgroundEffect 的 LightWave 通道
  ctx.globalCompositeOperation = "overlay";
  const wavePhase = (timestamp * 0.0003) % 1;
  const waveGradient = ctx.createLinearGradient(0, h * wavePhase, w, h * (1 - wavePhase));
  waveGradient.addColorStop(0, "rgba(255, 255, 255, 0)");
  waveGradient.addColorStop(0.45, "rgba(255, 255, 255, 0.04)");
  waveGradient.addColorStop(0.5, "rgba(255, 255, 255, 0.08)");
  waveGradient.addColorStop(0.55, "rgba(255, 255, 255, 0.04)");
  waveGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = waveGradient;
  ctx.fillRect(0, 0, w, h);

  // 暗色遮罩:与底色融合,让前景文字可读
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
  ctx.fillRect(0, 0, w, h);

  // 抖动:消除色带
  applyDither(ctx, w, h);

  if (needScale) ctx.restore();
};

/** 调整 Canvas 尺寸:渲染缩放 0.5x,blur(60px) 掩盖像素细节 */
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
 * 同步可见性:FullPlayer 收起 / 文档隐藏 / 暂停 时取消订阅
 * 文档隐藏由调度器统一处理；这里只需关心 isExpanded + isPlaying
 */
const updateVisibility = (): void => {
  const visible = !document.hidden && status.isExpanded;
  if (visible && !unsubscribe) {
    const now = performance.now();
    lastPaletteChangeAt = now;
    lastBreathActiveAt = now;
    unsubscribe = subscribeRaf(draw, FRAME_INTERVAL);
  } else if (!visible && unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
};

watch(
  [() => props.dominantColor, () => props.palette],
  () => {
    // 调色板变化时刷新静止计时器,确保后续 SETTLE_DELAY_MS 时长内持续重绘
    lastPaletteChangeAt = performance.now();
    initBlobs();
  },
  { deep: true },
);

onMounted(() => {
  initBlobs();
  buildNoiseTextures();
  resizeCanvas();
  // 父元素从 display:none 切换为可见时,clientWidth/Height 才会变为真实值
  // 仅 window resize 无法捕获 v-show 切换,必须用 ResizeObserver
  resizeObserver = new ResizeObserver(() => resizeCanvas());
  if (canvasRef.value?.parentElement) {
    resizeObserver.observe(canvasRef.value.parentElement);
  }
  window.addEventListener("resize", resizeCanvas);
  document.addEventListener("visibilitychange", updateVisibility);
  // 展开/收起 + 播放/暂停切换时同步订阅
  watch([() => status.isExpanded, () => status.isPlaying], updateVisibility);
  updateVisibility();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener("resize", resizeCanvas);
  document.removeEventListener("visibilitychange", updateVisibility);
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  noiseCanvasWhite = null;
  noiseCanvasBlack = null;
});
</script>

<template>
  <canvas ref="canvasRef" class="fluid-background-canvas2d" />
</template>

<style scoped>
.fluid-background-canvas2d {
  position: absolute;
  inset: 0;
  filter: blur(48px);
  pointer-events: none;
  will-change: auto;
}
</style>