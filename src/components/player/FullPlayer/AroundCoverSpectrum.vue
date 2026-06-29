<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { getFftFrame } from "@/services/playback";
import { acquireFft, releaseFft } from "@/services/fftCapture";
import { useBreathing } from "@/composables/useBreathing";

interface Props {
  /** 是否处于活跃状态 */
  show?: boolean;
}

withDefaults(defineProps<Props>(), {
  show: true,
});

const status = useStatusStore();
const settings = useSettingsStore();

const canvasRef = ref<HTMLCanvasElement | null>(null);

/** FFT 数据长度（与 BottomSpectrum 一致） */
const FFT_SIZE = 128;
/** 跳过的极低频段（噪声多） */
const SKIP_LOW = 4;
/** 后端推送间隔（ms），与 audio-engine 的 32ms FFT 定时器对齐 */
const PUSH_INTERVAL = 32;
/** RAF 节流间隔(ms),30fps 与后端推送对齐 */
const FRAME_INTERVAL = 32;
/** 环绕条数量；2 的倍数便于左右镜像 */
const NUM_BARS = 64;
/**
 * 内圈半径（相对画布短边的比例）
 * 画布向外扩展 20%（inset: -20%），故封面边缘在画布的 50%/1.4 ≈ 0.357 处
 * 0.38 略大于封面边缘，让条出现在封面外圈
 */
const INNER_RADIUS_RATIO = 0.38;
/** 最大条长（相对画布短边的比例） */
const MAX_BAR_LENGTH_RATIO = 0.1;
/** 条宽（弧度） */
const BAR_WIDTH_RAD = (Math.PI * 2) / NUM_BARS / 1.6;
/** 辉光层模糊半径（px） */
const GLOW_BLUR = 12;
/** 低频段结束 bin（用于驱动光环） */
const BASS_BIN_END = 6;
/** DPR 上限:限制高 DPI 屏渲染像素开销 */
const MAX_DPR = 1.5;

const prev = new Float32Array(FFT_SIZE);
const curr = new Float32Array(FFT_SIZE);
const display = new Float32Array(FFT_SIZE);
let lastRef: readonly number[] = [];
let lastUpdate = 0;

/** 共享节拍 scale，让光环与封面呼吸同步 */
const { scale: breathingScale } = useBreathing();

/** 调整画布分辨率：CSS 尺寸跟随父容器，这里只设置像素分辨率 */
const resizeCanvas = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height);
  if (size <= 0) return;
  // DPR 限制:径向频谱不需要超清,1.5 足够
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

/** 计算 NUM_BARS 个 bar 的归一化高度（0~1），左右镜像 */
const computeBarValues = (usableLen: number): number[] => {
  const values = new Array<number>(NUM_BARS);
  const halfBars = NUM_BARS / 2;
  for (let i = 0; i < halfBars; i++) {
    // 每个 bar 覆盖一段 bin，扩 1 个邻居做空间平滑
    const startBin = SKIP_LOW + Math.floor((i * usableLen) / halfBars);
    const endBin = SKIP_LOW + Math.floor(((i + 1) * usableLen) / halfBars);
    const lo = Math.max(SKIP_LOW, startBin - 1);
    const hi = Math.min(FFT_SIZE, Math.max(endBin, startBin + 1) + 1);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += display[j];
    const v = sum / (hi - lo);
    // 左右镜像：右半 i=0..halfBars-1，左半 i=NUM_BARS-1..halfBars
    values[i] = v;
    values[NUM_BARS - 1 - i] = v;
  }
  return values;
};

/**
 * 绘制单个径向条
 * @param ctx - canvas 上下文
 * @param cx - 圆心 x
 * @param cy - 圆心 y
 * @param innerR - 内半径
 * @param length - 条长度
 * @param angle - 角度（弧度）
 * @param width - 条宽（弧度）
 */
const drawRadialBar = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  innerR: number,
  length: number,
  angle: number,
  width: number,
): void => {
  if (length <= 0.5) return;
  ctx.beginPath();
  // 用扇形片段（圆环段）而非矩形，匹配圆形几何
  ctx.arc(cx, cy, innerR, angle - width / 2, angle + width / 2);
  ctx.arc(cx, cy, innerR + length, angle + width / 2, angle - width / 2, true);
  ctx.closePath();
  ctx.fill();
};

/** 绘制径向频谱条 */
const drawBars = (
  ctx: CanvasRenderingContext2D,
  values: number[],
  cx: number,
  cy: number,
  innerR: number,
  maxLen: number,
): void => {
  for (let i = 0; i < values.length; i++) {
    const len = Math.min(maxLen, values[i] * maxLen * 1.5);
    // 起始角度从顶部 -π/2 开始，顺时针递增
    const angle = -Math.PI / 2 + (i / values.length) * Math.PI * 2;
    drawRadialBar(ctx, cx, cy, innerR, len, angle, BAR_WIDTH_RAD);
  }
};

/** 绘制径向光环（低频驱动的辉光圈） */
const drawHalo = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  innerR: number,
  bass: number,
  breathing: number,
): void => {
  // 光环半径随节拍呼吸 + 低频 swell
  const haloR = innerR * (1.02 + bass * 0.08 + (breathing - 1) * 0.5);
  const innerHalo = innerR * 0.96;
  const gradient = ctx.createRadialGradient(cx, cy, innerHalo, cx, cy, haloR);
  gradient.addColorStop(0, `rgba(255, 255, 255, 0)`);
  gradient.addColorStop(0.5, `rgba(255, 255, 255, ${0.15 + bass * 0.35})`);
  gradient.addColorStop(1, `rgba(255, 255, 255, 0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
  ctx.arc(cx, cy, innerHalo, 0, Math.PI * 2, true);
  ctx.fill();
};

/** 上次绘制时间戳,30fps 节流 */
let lastDrawTime = 0;
/** display 是否仍在衰减(避免静止时空转重绘) */
let displaySettling = false;

/** 主绘制循环（30fps 节流,与后端 FFT 推送对齐） */
const draw = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 30fps 节流
  const now = performance.now();
  if (now - lastDrawTime < FRAME_INTERVAL) return;
  lastDrawTime = now;

  // 检测新帧推送
  const data = getFftFrame();
  const newData = data !== lastRef;
  if (newData) {
    lastRef = data;
    prev.set(curr);
    for (let i = 0; i < FFT_SIZE; i++) curr[i] = data[i] ?? 0;
    lastUpdate = now;
    displaySettling = true;
  }

  // 静止优化
  if (!newData && !displaySettling) return;

  // 时间插值
  const t = Math.min((now - lastUpdate) / PUSH_INTERVAL, 1);
  const smoothing = settings.player.spectrumSmoothing;
  const ATTACK = 0.4 * (1 - smoothing * 0.9);
  const DECAY = 0.88 + smoothing * 0.09;

  let settling = false;
  for (let i = 0; i < FFT_SIZE; i++) {
    const target = prev[i] + (curr[i] - prev[i]) * t;
    if (target > display[i]) {
      display[i] = display[i] + (target - display[i]) * ATTACK;
      settling = true;
    } else {
      display[i] = display[i] * DECAY + target * (1 - DECAY);
      if (Math.abs(display[i] - target) > 0.001) settling = true;
    }
  }
  displaySettling = settling;

  const cssSize = canvas.clientWidth;
  const cx = cssSize / 2;
  const cy = cssSize / 2;
  const innerR = cssSize * INNER_RADIUS_RATIO;
  const maxLen = cssSize * MAX_BAR_LENGTH_RATIO;
  const usableLen = FFT_SIZE - SKIP_LOW;
  const sensitivity = settings.player.spectrumSensitivity;
  const values = computeBarValues(usableLen).map((v) => v * sensitivity);

  // 低频均值（驱动光环）
  let bassSum = 0;
  const bassEnd = Math.min(BASS_BIN_END, display.length);
  for (let i = 0; i < bassEnd; i++) bassSum += display[i];
  const bass = Math.min(1, bassSum / bassEnd);

  ctx.clearRect(0, 0, cssSize, cssSize);
  const fillStyle = getComputedStyle(canvas).color;

  // 光环层（在条之下）
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  drawHalo(ctx, cx, cy, innerR, bass, breathingScale.value);
  ctx.restore();

  // 辉光层：模糊 + lighter 混合
  ctx.save();
  ctx.filter = `blur(${GLOW_BLUR}px)`;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = fillStyle;
  drawBars(ctx, values, cx, cy, innerR, maxLen);
  ctx.restore();

  // 清晰层
  ctx.fillStyle = fillStyle;
  drawBars(ctx, values, cx, cy, innerR, maxLen);
};

const { resume, pause } = useRafFn(draw, { immediate: false });

let fftAcquired = false;

const startCapture = (): void => {
  if (!fftAcquired) {
    acquireFft();
    fftAcquired = true;
  }
  resume();
};

const stopCapture = (): void => {
  pause();
  if (fftAcquired) {
    releaseFft();
    fftAcquired = false;
  }
};

watch(
  () => status.isPlaying,
  (playing) => {
    if (playing) startCapture();
    else stopCapture();
  },
  { immediate: true },
);

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
  // 监听容器尺寸变化（封面尺寸跟随窗口高度变化）
  if (canvasRef.value?.parentElement) {
    resizeObserver = new ResizeObserver(() => resizeCanvas());
    resizeObserver.observe(canvasRef.value.parentElement);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCanvas);
  resizeObserver?.disconnect();
  resizeObserver = null;
  stopCapture();
  prev.fill(0);
  curr.fill(0);
  display.fill(0);
  lastRef = [];
});
</script>

<template>
  <div
    class="absolute pointer-events-none transition-opacity duration-500 around-spectrum-wrap"
    :style="{ opacity: show ? 1 : 0 }"
  >
    <canvas ref="canvasRef" class="around-spectrum-canvas" />
  </div>
</template>

<style scoped>
/* 向外扩展 20%，让条出现在封面外圈；置于封面之下（z-index: -1） */
.around-spectrum-wrap {
  inset: -20%;
  z-index: -1;
}

.around-spectrum-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  color: rgb(var(--s-cover));
}
</style>
