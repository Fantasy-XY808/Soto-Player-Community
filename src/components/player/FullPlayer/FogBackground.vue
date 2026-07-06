<script setup lang="ts">
/**
 * 雾气背景层
 * 参照 BetterLyrics 的 FogEffect,使用 Canvas 2D + 旋转矩阵 fbm 噪声绘制流动雾气
 * 应用 shader 方案 B 优化:Pow(0.717) alpha 曲线(替代 Pow(1.4))、octave 间旋转矩阵 [1.6,-1.2;1.2,1.6]、
 * 高度衰减 (1 - uv.y*0.5)、UV 扰动 hash/512、0.05 淡化系数、双采样累加除以 2
 * 低分辨率 offscreen 噪声拉伸放大,配合 CSS blur 形成柔和雾感
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
}

const props = withDefaults(defineProps<Props>(), {
  dominantColor: null,
});

const status = useStatusStore();
const { scale } = useBreathing();

const canvasRef = ref<HTMLCanvasElement | null>(null);
/** 当前订阅取消函数；非空表示正在订阅共享 RAF */
let unsubscribe: (() => void) | null = null;
// 监听父元素尺寸变化,处理 FullPlayer v-show="isExpanded" 切换时 canvas 0×0 的问题
let resizeObserver: ResizeObserver | null = null;
/** RAF 节流间隔(ms),20fps 足够雾气效果,blur(32px) 掩盖帧间差异 */
const FRAME_INTERVAL = 50;
/**
 * 渲染缩放:canvas 实际像素 = CSS 像素 * RENDER_SCALE
 * blur(32px) 完全掩盖像素细节,0.4x 渲染省 84% 像素开销,视觉无差异
 */
const RENDER_SCALE = 0.4;

/** 噪声采样分辨率(低分辨率拉伸 + CSS blur 形成雾感) */
const NOISE_W = 48;
const NOISE_H = 27;
/** UV 缩放,对应 shader 中 uv *= 1.4 后再 * 5 的等效频率 */
const NOISE_FREQ = 0.5;
/** 时间流动速度 */
const TIME_SPEED = 0.00004;
/** 0.05 淡化系数后的补偿放大,让雾气在 screen 混合下可见 */
const INTENSITY_BOOST = 12;

/** offscreen canvas 与 ImageData,模块级复用避免每帧分配 */
let offscreen: HTMLCanvasElement | null = null;
let offCtx: CanvasRenderingContext2D | null = null;
let offImageData: ImageData | null = null;
/** 双采样累加缓冲,模块级复用 */
let accum: Float32Array | null = null;

/** 整数哈希:位运算版,返回 -1..1 (shader Hash 风格,用于 Noise) */
const hash2 = (x: number, y: number): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
};

/** 3 整数哈希:返回 -1..1 (用于 UV 扰动,需要包含 time 维度) */
const hash3 = (x: number, y: number, z: number): number => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return (((h ^ (h >>> 16)) >>> 0) / 4294967295) * 2 - 1;
};

/** 平滑插值(平滑 Hermite 曲线) */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 2D value noise:四角哈希双线性插值,返回 -1..1 (shader Noise 风格) */
const valueNoise = (x: number, y: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = smooth(fx);
  const uy = smooth(fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
};

/**
 * 2 octave fbm:第二 octave 应用旋转矩阵 [1.6,-1.2;1.2,1.6]
 * 对应 shader GenNoise:color = 0.5*Noise(p*5+t) + 0.25*Noise(p_rotated*5+t)
 */
const fbm = (x: number, y: number, t: number): number => {
  const n1 = valueNoise(x * 5 + t, y * 5 + t) * 0.5;
  const rx = 1.6 * x - 1.2 * y;
  const ry = 1.2 * x + 1.6 * y;
  const n2 = valueNoise(rx * 5 + t, ry * 5 + t) * 0.25;
  return n1 + n2;
};

/** 初始化 offscreen canvas 与累加缓冲 */
const initOffscreen = (): void => {
  offscreen = document.createElement("canvas");
  offscreen.width = NOISE_W;
  offscreen.height = NOISE_H;
  offCtx = offscreen.getContext("2d");
  if (offCtx) {
    offImageData = offCtx.createImageData(NOISE_W, NOISE_H);
    accum = new Float32Array(NOISE_W * NOISE_H);
  }
};

/** 绘制单帧 */
const draw = (timestamp: number): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx || !offCtx || !offscreen || !offImageData || !accum) return;

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

  const color = props.dominantColor ?? { r: 200, g: 200, b: 220 };
  const { r, g, b } = color;
  const t = timestamp * TIME_SPEED;
  // UV 扰动用整数 time,避免浮点 hash 不稳定
  const tInt = Math.floor(t);
  const data = offImageData.data;
  accum.fill(0);

  // 双采样累加:对应 shader 的 for(count=0; count<2; count++)
  for (let count = 0; count < 2; count++) {
    for (let y = 0; y < NOISE_H; y++) {
      const uvy = (y / NOISE_H) * 2 - 1; // -1..1
      // 高度衰减:顶部更亮,对应 shader 1 - uv.y*0.5 (uv.y 范围 -1..1)
      const heightFactor = 1 - uvy * 0.5; // 0.5..1.5
      for (let x = 0; x < NOISE_W; x++) {
        const uvx = (x / NOISE_W) * 2 - 1; // -1..1
        // UV 扰动: hash(uv + time + count) / 512,打破 moiré
        const perturbX = hash3(x, y, tInt + count) / 512;
        const perturbY = hash3(y, x, tInt + count) / 512;
        const fx = (uvx + perturbX) * NOISE_FREQ;
        const fy = (uvy + perturbY) * NOISE_FREQ;
        // fbm + 0.5 系数 (shader: GenNoise * 0.5)
        const n = fbm(fx, fy, t) * 0.5;
        // 整体淡化 0.05 (shader: noiseVal *= 0.05)
        const faded = Math.max(0, n) * heightFactor * 0.05;
        // Pow(0.717) alpha 曲线 (shader: Pow(Max(0, noiseVal), 0.717))
        const alpha = Math.pow(faded, 0.717);
        accum[y * NOISE_W + x] += alpha;
      }
    }
  }

  // 双采样除以 2 + 补偿放大,写入 ImageData
  const len = NOISE_W * NOISE_H;
  for (let i = 0; i < len; i++) {
    const finalAlpha = Math.min(1, (accum[i] / 2) * INTENSITY_BOOST);
    const idx = i * 4;
    data[idx] = r;
    data[idx + 1] = g;
    data[idx + 2] = b;
    data[idx + 3] = Math.floor(finalAlpha * 255);
  }
  offCtx.putImageData(offImageData, 0, 0);

  // 拉伸放大 + 屏幕混合,亮处叠加形成雾团
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(offscreen, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";

  if (needScale) ctx.restore();
};

/** 调整 Canvas 尺寸:渲染缩放 0.4x,blur(32px) 掩盖像素细节 */
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
  initOffscreen();
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
  offscreen = null;
  offCtx = null;
  offImageData = null;
  accum = null;
});
</script>

<template>
  <canvas ref="canvasRef" class="fog-background" />
</template>

<style scoped>
.fog-background {
  position: absolute;
  inset: 0;
  filter: blur(32px);
  pointer-events: none;
}
</style>
