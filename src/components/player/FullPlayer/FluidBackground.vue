<script setup lang="ts">
/**
 * 流体背景
 * 参照 BetterLyrics 的 FluidBackgroundEffect HLSL 着色器,用 Canvas 2D 近似实现:
 * - 6 色块径向渐变 + lighter 混合(原 4 色升级,层次更丰富)
 * - HSV 色彩混合:同色相内插值,避免 RGB 直接 lerp 时的灰浊过渡
 * - 光波(LightWave):高频微纹波,提升"流动感"
 * - 抖动(Dithering):消除大片渐变的色带,肉眼更平滑
 * - 节拍呼吸:scale > 1 时围绕中心放大,与 BetterLyrics 的 bass energy 推动一致
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
  palette?: RGB[];
}

const props = withDefaults(defineProps<Props>(), {
  dominantColor: null,
  palette: () => [],
});

const status = useStatusStore();
const { scale } = useBreathing();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let rafId = 0;
let visible = true;
// 监听父元素尺寸变化,处理 FullPlayer v-show="isExpanded" 切换时 canvas 0×0 的问题
let resizeObserver: ResizeObserver | null = null;
/** RAF 节流间隔(ms),30fps 足够流体效果,blur(60px) 掩盖帧间差异 */
const FRAME_INTERVAL = 32;
/** 上次绘制时间戳 */
let lastDrawTime = 0;
/**
 * 渲染缩放:canvas 实际像素 = CSS 像素 * RENDER_SCALE
 * blur(60px) 完全掩盖像素细节,0.5x 渲染省 75% 像素开销,视觉无差异
 */
const RENDER_SCALE = 0.5;

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
 * 生成 6 个色块:基于 palette 通过 HSV 插值扩展,保持色相一致性
 * BetterLyrics 的着色器接收 4 色,但本项目通过 HSV 派生 6 色,层次更丰富
 */
const buildBlobColors = (): RGB[] => {
  const pal = props.palette.length >= 2 ? props.palette.slice(0, 4) : [];
  if (pal.length >= 2) {
    // 派生:相邻 palette 色各取 1,中间插值 1,共 6 色
    const derived: RGB[] = [];
    for (let i = 0; i < pal.length; i++) {
      derived.push(pal[i]);
      const next = pal[(i + 1) % pal.length];
      derived.push(lerpHsv(pal[i], next, 0.5));
    }
    return derived.slice(0, 6);
  }
  if (props.dominantColor) {
    // 单主色:派生 6 个色相偏移变体
    const [h, s, v] = rgbToHsv(props.dominantColor.r, props.dominantColor.g, props.dominantColor.b);
    return Array.from({ length: 6 }, (_, i) => {
      const dh = (i - 2.5) * 18; // ±45° 色相分散
      return hsvToRgb((h + dh + 360) % 360, Math.min(1, s + 0.1), Math.min(1, v + 0.05));
    });
  }
  // 兜底:深紫蓝调
  return [
    { r: 30, g: 30, b: 50 },
    { r: 20, g: 20, b: 40 },
    { r: 40, g: 25, b: 45 },
    { r: 25, g: 35, b: 55 },
    { r: 35, g: 20, b: 50 },
    { r: 45, g: 30, b: 40 },
  ];
};

/** 初始化色块 */
const initBlobs = (): void => {
  const colors = buildBlobColors();
  const result: Blob[] = colors.map((color, i) => ({
    x: 0.15 + i / colors.length + (Math.random() - 0.5) * 0.2,
    y: 0.2 + Math.random() * 0.6,
    radius: 0.28 + Math.random() * 0.18,
    color,
    speedX: 0.0003 + Math.random() * 0.0005,
    speedY: 0.0003 + Math.random() * 0.0005,
    phaseX: i * 1.7 + Math.random(),
    phaseY: i * 2.3 + Math.random(),
    drift: (Math.random() - 0.5) * 0.0002,
  }));
  blobs.value = result;
};

/**
 * 抖动:在像素上叠加 ±1 的 RGB 抖动,消除大片渐变的色带
 * BetterLyrics 的 ScreenSpaceDither 在 HLSL 中做,Canvas 2D 用 imageData 后处理成本太高
 * 此处只在最终合成后做一次轻量抖动:在画布上撒随机噪点
 */
const applyDither = (ctx: CanvasRenderingContext2D, w: number, h: number): void => {
  const noise = 8;
  const count = Math.floor((w * h) / 400);
  ctx.fillStyle = "rgba(255, 255, 255, 0.015)";
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = `rgba(0, 0, 0, ${noise / 255})`;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    ctx.fillRect(x, y, 1, 1);
  }
};

/** 绘制帧(30fps 节流) */
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
  if (!ctx) {
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

  // 节拍呼吸:scale > 1 时围绕中心放大
  const s = scale.value;
  const needScale = s > 1.001;
  if (needScale) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-w / 2, -h / 2);
  }

  // 深底色:取主色暗化,避免纯黑显得发闷
  const baseColor = props.dominantColor ?? { r: 18, g: 18, b: 22 };
  const baseR = Math.max(8, Math.floor(baseColor.r * 0.15));
  const baseG = Math.max(8, Math.floor(baseColor.g * 0.15));
  const baseB = Math.max(10, Math.floor(baseColor.b * 0.15));
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
  ctx.fillRect(0, 0, w, h);

  // 绘制色块:6 个径向渐变 + lighter 混合
  const currentBlobs = blobs.value;
  ctx.globalCompositeOperation = "lighter";
  for (const blob of currentBlobs) {
    // 圆周漂移:色块在画布上沿小圆轨迹移动,避免长期停留在同位置
    const driftX = Math.sin(timestamp * blob.drift) * 0.05;
    const driftY = Math.cos(timestamp * blob.drift) * 0.05;
    const bx = (blob.x + Math.sin(timestamp * blob.speedX + blob.phaseX) * 0.18 + driftX) * w;
    const by = (blob.y + Math.cos(timestamp * blob.speedY + blob.phaseY) * 0.18 + driftY) * h;
    const br = blob.radius * Math.min(w, h);

    const gradient = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    const { r, g, b } = blob.color;
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.55)`);
    gradient.addColorStop(0.4, `rgba(${r}, ${g}, ${b}, 0.25)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
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
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(0, 0, w, h);

  // 抖动:消除色带
  applyDither(ctx, w, h);

  if (needScale) ctx.restore();

  rafId = requestAnimationFrame(draw);
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
 * 同步可见性:FullPlayer 收起 / 文档隐藏 / 暂停 时停止 RAF
 * 暂停时流体背景静止可接受(节拍呼吸也停止),恢复时从下一帧继续
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

watch(
  [() => props.dominantColor, () => props.palette],
  () => {
    initBlobs();
  },
  { deep: true },
);

onMounted(() => {
  initBlobs();
  resizeCanvas();
  // 父元素从 display:none 切换为可见时,clientWidth/Height 才会变为真实值
  // 仅 window resize 无法捕获 v-show 切换,必须用 ResizeObserver
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
});
</script>

<template>
  <canvas ref="canvasRef" class="fluid-background" />
</template>

<style scoped>
.fluid-background {
  position: absolute;
  inset: 0;
  filter: blur(60px);
  pointer-events: none;
}
</style>
