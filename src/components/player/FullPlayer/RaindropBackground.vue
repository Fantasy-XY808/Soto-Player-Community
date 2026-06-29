<script setup lang="ts">
/**
 * 雨滴背景层
 * 参照 BetterLyrics 的 RaindropRenderer,使用 Canvas 2D 绘制倾斜雨滴
 * 雨滴从顶部斜向下落,每条雨滴绘制线性渐变拖尾;整体随节拍呼吸轻微放大
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
/** RAF 节流间隔(ms),30fps 与后端 FFT 推送对齐,雨滴下落视觉无差异 */
const FRAME_INTERVAL = 32;
/** 上次绘制时间戳 */
let lastDrawTime = 0;
/** 渲染缩放:雨滴为细线,1.0x 已足够,省去高 DPI 屏 4 倍像素开销 */
const RENDER_SCALE = 1.0;

/** 雨滴数量上限 */
const RAINDROP_COUNT = 120;
/** 雨滴倾斜角度(弧度) */
const TILT_ANGLE = 0.25;
/** 雨滴长度范围(px) */
const MIN_LENGTH = 12;
const MAX_LENGTH = 28;
/** 雨滴速度范围(每秒占容器高度比例) */
const MIN_SPEED = 0.6;
const MAX_SPEED = 1.4;

interface Raindrop {
  x: number;
  y: number;
  length: number;
  speed: number;
  alpha: number;
}

const raindrops = shallowRef<Raindrop[]>([]);

/** 初始化雨滴 */
const initRaindrops = (): void => {
  const result: Raindrop[] = [];
  for (let i = 0; i < RAINDROP_COUNT; i++) {
    result.push({
      x: Math.random(),
      y: Math.random(),
      length: MIN_LENGTH + Math.random() * (MAX_LENGTH - MIN_LENGTH),
      speed: MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED),
      alpha: 0.2 + Math.random() * 0.4,
    });
  }
  raindrops.value = result;
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

  const color = props.dominantColor ?? { r: 180, g: 200, b: 230 };
  const { r, g, b } = color;

  const dx = Math.sin(TILT_ANGLE);
  const dy = Math.cos(TILT_ANGLE);
  const speedFactor = timestamp * 0.001;

  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, w * 0.0008);
  const drops = raindrops.value;
  for (const drop of drops) {
    const startY = (((drop.y + speedFactor * drop.speed) % 1.2) - 0.2) * h;
    const startX = (drop.x + (startY / h) * Math.tan(TILT_ANGLE) * 0.5) * w;
    // 尾端在前段下方(endY < startY,因为 dy 是向下方向),这里拖尾朝向运动反方向
    const endX = startX - dx * drop.length;
    const endY = startY - dy * drop.length;

    // 线性渐变:起点亮,尾端透明,形成拖尾感
    const grad = ctx.createLinearGradient(startX, startY, endX, endY);
    grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${drop.alpha})`);
    grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.strokeStyle = grad;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(endX, endY);
    ctx.stroke();
  }

  if (needScale) ctx.restore();

  rafId = requestAnimationFrame(draw);
};

/** 调整 Canvas 尺寸:雨滴为细线,DPR 限制 1.0 省去高 DPI 屏 4 倍像素开销 */
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
 * 暂停时雨滴静止可接受(节拍呼吸也停止),恢复时从下一帧继续
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
  initRaindrops();
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
});
</script>

<template>
  <canvas ref="canvasRef" class="raindrop-background" />
</template>

<style scoped>
.raindrop-background {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
