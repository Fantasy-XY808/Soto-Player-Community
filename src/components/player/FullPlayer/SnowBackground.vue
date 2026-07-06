<script setup lang="ts">
/**
 * 雪花背景层
 * 参照 BetterLyrics 的 SnowEffect,使用 Canvas 2D + 距离场 alpha 绘制 6 层视差雪花
 * 每层 i 控制 cellSize、速度(1/i)、摆动(5/i):近层大快稀,远层小慢密
 * 雪花形状用距离场公式 Clamp(1.9 - d*(15+x*6.3)*(cellSize/1.4), 0, 1) 计算 alpha,
 * 通过 2 层 arc + globalAlpha 累加实现 soft edge,而非单一硬边圆形
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
  palette?: RGB[];
}

const props = withDefaults(defineProps<Props>(), {
  palette: () => [],
});

const status = useStatusStore();
const { scale } = useBreathing();

const canvasRef = ref<HTMLCanvasElement | null>(null);
/** 当前订阅取消函数；非空表示正在订阅共享 RAF */
let unsubscribe: (() => void) | null = null;
// 监听父元素尺寸变化,处理 FullPlayer v-show="isExpanded" 切换时 canvas 0×0 的问题
let resizeObserver: ResizeObserver | null = null;
/** RAF 节流间隔(ms),20fps 足够雪花慢速运动,减少 33% 绘制 */
const FRAME_INTERVAL = 50;
/** 渲染缩放:雪花为简单圆点,0.5x 足够,高 DPI 屏省 75% 像素 */
const RENDER_SCALE = 0.5;

/** 6 个层,从远到近:i 越大 cellSize 越大(网格多)、半径小、速度慢 */
const LAYERS = [
  { k: 0, i: 11, cellSize: 35 },
  { k: 1, i: 9, cellSize: 29 },
  { k: 2, i: 7, cellSize: 23 },
  { k: 3, i: 5, cellSize: 17 },
  { k: 4, i: 3, cellSize: 11 },
  { k: 5, i: 1, cellSize: 5 },
] as const;

/** 每个网格点生成雪花的概率(对应 shader 的 omiVal < density) */
const DENSITY = 0.1;

interface Snowflake {
  k: number;
  i: number;
  cellSize: number;
  /** 网格点 UV 坐标 0..1 */
  uvX: number;
  uvY: number;
  /** 距离场公式中的 x 偏移,-0.5..0.5 */
  randX: number;
  randY: number;
}

const flakes = shallowRef<Snowflake[]>([]);

/** shader: x = Frac(Sin(Dot(uvStep, (12.9898+k*12, 78.233+k*315.156))) * 43758.5453 + k*12) - 0.5 */
const hashX = (gx: number, gy: number, k: number): number => {
  const dot = gx * (12.9898 + k * 12.0) + gy * (78.233 + k * 315.156);
  const s = Math.sin(dot) * 43758.5453 + k * 12.0;
  return s - Math.floor(s) - 0.5;
};

/** shader: y = Frac(Sin(Dot(uvStep, (62.2364+k*23, 94.674+k*95))) * 62159.8432 + k*12) - 0.5 */
const hashY = (gx: number, gy: number, k: number): number => {
  const dot = gx * (62.2364 + k * 23.0) + gy * (94.674 + k * 95.0);
  const s = Math.sin(dot) * 62159.8432 + k * 12.0;
  return s - Math.floor(s) - 0.5;
};

/** shader: omiVal = Frac(Sin(Dot(uvStep, (32.4691, 94.615))) * 31572.1684) */
const hashOmi = (gx: number, gy: number): number => {
  const dot = gx * 32.4691 + gy * 94.615;
  const s = Math.sin(dot) * 31572.1684;
  return s - Math.floor(s);
};

/** 初始化雪花:按 cellSize 网格采样,每点用 density 概率决定是否生成 */
const initSnowflakes = (): void => {
  const result: Snowflake[] = [];
  for (const layer of LAYERS) {
    const { k, i, cellSize } = layer;
    const step = 1 / cellSize;
    // 覆盖 [-0.1, 1.1] UV 区域,允许滚动时边缘不出空白
    for (let gy = -0.1; gy <= 1.1 + step; gy += step) {
      for (let gx = -0.1; gx <= 1.1 + step; gx += step) {
        if (hashOmi(gx, gy) >= DENSITY) continue;
        result.push({
          k,
          i,
          cellSize,
          uvX: gx,
          uvY: gy,
          randX: hashX(gx, gy, k),
          randY: hashY(gx, gy, k),
        });
      }
    }
  }
  flakes.value = result;
};

/** 距离场最大半径:alpha=0 时的 d,换算到 px (shader 中 d 是 UV 距离的 5 倍) */
const maxRadius = (cellSize: number, randX: number, w: number): number => {
  const denom = (15 + randX * 6.3) * (cellSize / 1.4);
  if (denom <= 0) return 1;
  const dMax = 1.9 / denom;
  return Math.max(0.5, (dMax * w) / 5);
};

/** 距离场中心 alpha:d=0 时 Clamp(1.9, 0, 1) * (x+1)*0.4 = (x+1)*0.4 */
const centerAlpha = (randX: number): number => Math.min(1, (randX + 1) * 0.4);

/** 绘制单帧 */
const draw = (timestamp: number): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  if (w === 0 || h === 0) return;
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

  const color = props.palette[0] ?? { r: 255, g: 255, b: 255 };
  const { r, g, b } = color;
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  const tSec = timestamp * 0.001;

  for (const flake of flakes.value) {
    const { k, i, cellSize, uvX, uvY, randX } = flake;
    // 摆动幅度按 5/i 缩放:近层摆动大,远层几乎不动
    const swing = 0.01 * Math.sin((tSec + k * 6.185) * 0.6 + i) * (5 / i);
    // 速度按 1/i 缩放:近层快,远层慢
    const downSpeed = 0.3 + (Math.sin(tSec * 0.4 + k + i * 20) + 1) * 0.00008;
    const uvYNow = uvY + (tSec * downSpeed) / i;
    // 包裹到 [-0.1, 1.1] 范围,允许雪花从屏幕外滚入
    const yWrapped = (((uvYNow % 1.2) + 1.2) % 1.2) - 0.1;
    const py = yWrapped * h;
    const px = (uvX + swing) * w;
    if (py < -30 || py > h + 30) continue;

    const rMax = maxRadius(cellSize, randX, w);
    const baseA = centerAlpha(randX);
    // 2 层 arc + globalAlpha 累加,模拟距离场 soft edge
    ctx.globalAlpha = baseA * 0.9;
    ctx.beginPath();
    ctx.arc(px, py, rMax * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = baseA * 0.25;
    ctx.beginPath();
    ctx.arc(px, py, rMax, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (needScale) ctx.restore();
};

/** 调整 Canvas 尺寸:雪花为简单圆点,DPR 限制 1.0 省去高 DPI 屏 4 倍像素开销 */
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
  const visible = !document.hidden && status.isExpanded && status.isPlaying;
  if (visible && !unsubscribe) {
    unsubscribe = subscribeRaf(draw, FRAME_INTERVAL);
  } else if (!visible && unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
};

onMounted(() => {
  initSnowflakes();
  resizeCanvas();
  // 父元素从 display:none 切换为可见时,clientWidth/Height 才会变为真实值
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
});
</script>

<template>
  <canvas ref="canvasRef" class="snow-background" />
</template>

<style scoped>
.snow-background {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
