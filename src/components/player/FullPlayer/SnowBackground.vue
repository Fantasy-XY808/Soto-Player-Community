<script setup lang="ts">
/**
 * 雪花背景层
 * 参照 BetterLyrics 的 SnowRenderer,使用 Canvas 2D 绘制雪花粒子
 * 3 层视差:外层大慢、中层中等、内层小快;整体随节拍呼吸轻微放大
 */

import { useStatusStore } from "@/stores/status";
import { useBreathing } from "@/composables/useBreathing";

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
let rafId = 0;
let visible = true;
// 监听父元素尺寸变化,处理 FullPlayer v-show="isExpanded" 切换时 canvas 0×0 的问题
let resizeObserver: ResizeObserver | null = null;
/** RAF 节流间隔(ms),30fps 与后端 FFT 推送对齐,雪花慢速运动视觉无差异 */
const FRAME_INTERVAL = 32;
/** 上次绘制时间戳 */
let lastDrawTime = 0;
/** 渲染缩放:雪花为简单圆点,1.0x 已足够,省去高 DPI 屏 4 倍像素开销 */
const RENDER_SCALE = 1.0;

/** 单层粒子配置 */
interface Snowflake {
  x: number;
  y: number;
  radius: number;
  speed: number;
  drift: number;
  phase: number;
  alpha: number;
}

/** 分层定义:外层大慢、中层中等、内层小快 */
interface SnowLayer {
  flakes: Snowflake[];
}

const layers = shallowRef<SnowLayer[]>([]);

/** 分层粒子数:外 30 / 中 30 / 内 20,合计 80 与原实现一致 */
const LAYER_CONFIGS = [
  { count: 30, radiusMin: 3, radiusMax: 5, speedMin: 0.0002, speedMax: 0.0004, alpha: 0.5 },
  { count: 30, radiusMin: 2, radiusMax: 3, speedMin: 0.0005, speedMax: 0.0008, alpha: 0.7 },
  { count: 20, radiusMin: 1, radiusMax: 2, speedMin: 0.0009, speedMax: 0.0014, alpha: 0.9 },
] as const;

/** 初始化三层雪花粒子 */
const initSnowflakes = (): void => {
  const result: SnowLayer[] = LAYER_CONFIGS.map((cfg) => {
    const flakes: Snowflake[] = [];
    for (let i = 0; i < cfg.count; i++) {
      flakes.push({
        x: Math.random(),
        y: Math.random(),
        radius: cfg.radiusMin + Math.random() * (cfg.radiusMax - cfg.radiusMin),
        speed: cfg.speedMin + Math.random() * (cfg.speedMax - cfg.speedMin),
        drift: 0.0001 + Math.random() * 0.0003,
        phase: Math.random() * Math.PI * 2,
        alpha: cfg.alpha,
      });
    }
    return { flakes };
  });
  layers.value = result;
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

  const color = props.palette[0] ?? { r: 255, g: 255, b: 255 };
  const { r, g, b } = color;
  for (const layer of layers.value) {
    for (const flake of layer.flakes) {
      const x = (flake.x + Math.sin(timestamp * flake.drift + flake.phase) * 0.05) * w;
      const y = ((flake.y + timestamp * flake.speed) % 1) * h;
      ctx.beginPath();
      ctx.arc(x, y, flake.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${flake.alpha})`;
      ctx.fill();
    }
  }

  if (needScale) ctx.restore();

  rafId = requestAnimationFrame(draw);
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
 * 同步可见性:FullPlayer 收起 / 文档隐藏 / 暂停 时停止 RAF
 * 暂停时雪花静止可接受(节拍呼吸也停止),恢复时从下一帧继续
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
  initSnowflakes();
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
  <canvas ref="canvasRef" class="snow-background" />
</template>

<style scoped>
.snow-background {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
</style>
