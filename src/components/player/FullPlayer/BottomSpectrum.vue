<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { getFftFrame } from "@/services/playback";
import { acquireFft, releaseFft } from "@/services/fftCapture";
import { subscribeRaf } from "@/services/rafScheduler";
import { useBreathing } from "@/composables/useBreathing";

interface Props {
  /** 是否处于活跃状态 */
  show?: boolean;
  /** 高度(px),默认 80 */
  height?: number;
  /** bar 圆角(px),默认 2 */
  radius?: number;
  /** 最大画布宽度(px),默认 1920 */
  maxWidth?: number;
}

const props = withDefaults(defineProps<Props>(), {
  show: true,
  height: 80,
  radius: 2,
  maxWidth: 1920,
});

const status = useStatusStore();
const media = useMediaStore();
const settings = useSettingsStore();

/** 频谱心跳：复用全局 breathing scale（低频驱动非对称 EMA），按强度映射为整体放大倍率 */
const { scale: breathingScale } = useBreathing();
/** useBreathing scale 偏移上限（与 useBreathing 内 MAX_SCALE_OFFSET 一致） */
const BREATHING_MAX_OFFSET = 0.08;
/** 心跳最大放大上限：intensity=100 时最大放大至 1.8x（与 BetterLyrics 一致） */
const HEART_MAX_OFFSET = 0.8;
/** 心跳容器样式：transform-origin 底部中心，scale 跟随低频与强度 */
const heartStyle = computed(() => {
  if (!settings.player.spectrumBreathing) return { transform: "scale(1)" };
  const intensity = Math.max(0, Math.min(1, settings.player.spectrumBreathingIntensity / 100));
  const bassEnergy = Math.max(0, (breathingScale.value - 1) / BREATHING_MAX_OFFSET);
  const offset = bassEnergy * intensity * HEART_MAX_OFFSET;
  return { transform: `scale(${(1 + offset).toFixed(4)})` };
});

const canvasRef = ref<HTMLCanvasElement | null>(null);

/** 后端推送数据长度 */
const FFT_SIZE = 128;
/** 极低频跳过的段数(噪声多) */
const SKIP_LOW = 8;
/** bar 之间的固定间隙(px) */
const BAR_GAP = 3;
/** 后端推送间隔(ms),与 audio-engine 的 32ms FFT 定时器对齐 */
const PUSH_INTERVAL = 32;
/** 辉光模糊半径(px) */
const GLOW_BLUR = 12;
/** RAF 节流间隔(ms),30fps 与后端推送对齐,避免 60fps 冗余插值 */
const FRAME_INTERVAL = 33;
/** DPR 上限:高 DPI 屏(2x)渲染像素 4 倍,限制到 1.0 减少 75% 像素开销 */
const MAX_DPR = 1.0;
/** 容器基础高度(px),最终高度 = 基础高度 × spectrumMaxHeight,跟随设置变化 */
const BASE_HEIGHT = 80;
/** 容器高度上限(px),避免设置过大撑爆底栏 */
const MAX_HEIGHT_PX = 240;

/** 实际渲染容器高度:基础高度 × spectrumMaxHeight,跟随设置变化 */
const effectiveHeight = computed(() => {
  const h = Math.round(BASE_HEIGHT * settings.player.spectrumMaxHeight);
  return Math.min(MAX_HEIGHT_PX, Math.max(40, h));
});

/** 上一帧推送数据 */
const prev = new Float32Array(FFT_SIZE);
/** 当前帧推送数据 */
const curr = new Float32Array(FFT_SIZE);
/** 实际渲染显示值(经过指数平滑) */
const display = new Float32Array(FFT_SIZE);
/** 上一次推送数据的引用,用于检测新帧到达 */
let lastRef: readonly number[] = [];
/** 上一次推送到达的时间戳 */
let lastUpdate = 0;

/** 调整画布大小 */
const resizeCanvas = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  // DPR 限制:高 DPI 屏渲染像素 4 倍,频谱不需要超清,1.5 足够
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const cssWidth = Math.min(document.body.clientWidth, props.maxWidth);
  const cssHeight = effectiveHeight.value;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

/** 计算 numBars 个 bar 的归一化高度(0~1),供 bar / curve 共用 */
const computeBarValues = (numBars: number, usableLen: number): number[] => {
  const values = new Array<number>(numBars);
  for (let i = 0; i < numBars; i++) {
    // 每个 bar 覆盖一段 bin,再扩 1 个邻居做空间平滑,避免相邻 bin 方差导致的悬崖
    const startBin = SKIP_LOW + Math.floor((i * usableLen) / numBars);
    const endBin = SKIP_LOW + Math.floor(((i + 1) * usableLen) / numBars);
    const lo = Math.max(SKIP_LOW, startBin - 1);
    const hi = Math.min(FFT_SIZE, Math.max(endBin, startBin + 1) + 1);
    let sum = 0;
    for (let j = lo; j < hi; j++) sum += display[j];
    values[i] = sum / (hi - lo);
  }
  return values;
};

/** 绘制柱状频谱 */
const drawBars = (
  ctx: CanvasRenderingContext2D,
  values: number[],
  halfWidth: number,
  slotWidth: number,
  barWidth: number,
  maxHeightPx: number,
  cssHeight: number,
): void => {
  for (let i = 0; i < values.length; i++) {
    const barHeight = Math.min(maxHeightPx, values[i] * cssHeight);
    const xRight = halfWidth + i * slotWidth;
    const xLeft = halfWidth - (i + 1) * slotWidth;
    if (barHeight > 0.5) {
      const y = cssHeight - barHeight;
      ctx.beginPath();
      ctx.roundRect(xRight, y, barWidth, barHeight, props.radius);
      ctx.roundRect(xLeft, y, barWidth, barHeight, props.radius);
      ctx.fill();
    }
  }
};

/** 绘制曲线频谱:Catmull-Rom 样条平滑,左右镜像闭合填充 */
const drawCurve = (
  ctx: CanvasRenderingContext2D,
  values: number[],
  halfWidth: number,
  slotWidth: number,
  maxHeightPx: number,
  cssHeight: number,
): void => {
  const numBars = values.length;
  if (numBars < 2) return;

  // 构造从左到右的 2*numBars 个采样点:左半镜像 + 右半
  const points: { x: number; y: number }[] = [];
  for (let i = numBars - 1; i >= 0; i--) {
    const v = Math.min(maxHeightPx, values[i] * cssHeight);
    points.push({ x: halfWidth - (i + 0.5) * slotWidth, y: cssHeight - v });
  }
  for (let i = 0; i < numBars; i++) {
    const v = Math.min(maxHeightPx, values[i] * cssHeight);
    points.push({ x: halfWidth + (i + 0.5) * slotWidth, y: cssHeight - v });
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  // Catmull-Rom 转 cubic Bezier:cp1 = p1 + (p2 - p0)/6, cp2 = p2 - (p3 - p1)/6
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i > 0 ? i - 1 : 0];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : points.length - 1];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
  // 闭合到底边填充
  ctx.lineTo(points[points.length - 1].x, cssHeight);
  ctx.lineTo(points[0].x, cssHeight);
  ctx.closePath();
  ctx.fill();
};

/** display 是否仍在衰减(避免静止时空转重绘) */
let displaySettling = false;
/** 共享 RAF 订阅取消函数；非空表示正在订阅 */
let unsubscribe: (() => void) | null = null;

/** 绘制频谱（由共享 RAF 调度器按 FRAME_INTERVAL 节流调用） */
const draw = (now: number): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

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

  // 静止优化:无新数据且 display 已收敛时跳过重绘
  if (!newData && !displaySettling) return;

  // 时间插值:在 prev → curr 之间按时间平滑过渡,消除帧间 stair-step
  const t = Math.min((now - lastUpdate) / PUSH_INTERVAL, 1);
  // 平滑度 0~0.9:越大上行越慢、下行越慢,频谱越柔和
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

  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  const usableLen = FFT_SIZE - SKIP_LOW;
  const barWidth = Math.max(1, settings.player.spectrumBarWidth);
  const slotWidth = barWidth + BAR_GAP;
  // 一侧能放下的 bar 数;不再限制 ≤ usableLen,允许过采样(多个相邻 bar 共用一个 bin 的均值)
  const numBars = Math.floor(cssWidth / 2 / slotWidth);
  if (numBars === 0) return;

  // 灵敏度增益 + 最大高度限制(容器已跟随 spectrumMaxHeight 缩放,bar 最高顶到容器顶留少量 padding)
  const sensitivity = settings.player.spectrumSensitivity;
  const maxHeightPx = cssHeight * 0.95;
  const values = computeBarValues(numBars, usableLen).map((v) => v * sensitivity);
  const isCurve = settings.player.spectrumStyle === "curve";

  ctx.clearRect(0, 0, cssWidth, cssHeight);
  // getComputedStyle 可能返回空字符串（CSS 变量未定义时），用 fallback 兜底
  // 避免空 fillStyle 导致频谱条透明不可见
  const computedColor = getComputedStyle(canvas).color;
  const fillStyle = computedColor || "rgb(255, 255, 255)";
  const halfWidth = cssWidth / 2;

  // 辉光层:模糊 + lighter 混合,颜色叠加变亮
  ctx.save();
  ctx.filter = `blur(${GLOW_BLUR}px)`;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = fillStyle;
  if (isCurve) {
    drawCurve(ctx, values, halfWidth, slotWidth, maxHeightPx, cssHeight);
  } else {
    drawBars(ctx, values, halfWidth, slotWidth, barWidth, maxHeightPx, cssHeight);
  }
  ctx.restore();

  // 清晰层:source-over 默认,绘制主体
  ctx.fillStyle = fillStyle;
  if (isCurve) {
    drawCurve(ctx, values, halfWidth, slotWidth, maxHeightPx, cssHeight);
  } else {
    drawBars(ctx, values, halfWidth, slotWidth, barWidth, maxHeightPx, cssHeight);
  }
};

// 本地持有标记,保证 acquire / release 严格配对
let fftAcquired = false;

const startCapture = (): void => {
  if (!fftAcquired) {
    acquireFft();
    fftAcquired = true;
  }
  if (!unsubscribe) {
    unsubscribe = subscribeRaf(draw, FRAME_INTERVAL);
  }
};

const stopCapture = (): void => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (fftAcquired) {
    releaseFft();
    fftAcquired = false;
  }
};

// 暂停时停止 FFT 推送 + RAF 重绘
watch(
  () => status.isPlaying,
  (playing) => {
    if (playing) startCapture();
    else stopCapture();
  },
  { immediate: true },
);

// 容器高度跟随 spectrumMaxHeight 变化时重新调整画布
watch(effectiveHeight, () => resizeCanvas());

// 切歌时触发一次重绘清除 canvas
watch(
  () => media.track?.id,
  () => {
    displaySettling = true;
  },
);

onMounted(() => {
  resizeCanvas();
  window.addEventListener("resize", resizeCanvas);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCanvas);
  stopCapture();
  prev.fill(0);
  curr.fill(0);
  display.fill(0);
  lastRef = [];
});
</script>

<template>
  <div
    class="absolute left-0 bottom-0 w-full flex justify-center z-0 pointer-events-none transition-opacity duration-300"
    :style="{ opacity: show ? 0.85 : 0.15, ...heartStyle, transformOrigin: 'bottom center' }"
  >
    <canvas ref="canvasRef" class="spectrum-canvas" />
  </div>
</template>

<style scoped>
.spectrum-canvas {
  /* 显式设置颜色，不依赖 CSS 继承链（继承链断裂时 getComputedStyle().color
     可能返回空字符串，导致 fillStyle 无效 → 频谱条透明不可见） */
  color: var(--spectrum-color, rgb(var(--s-cover)));
  /* 亮度/饱和度由父级 CSS 变量驱动：固定值 + 智能调暗叠加 */
  filter: brightness(var(--spectrum-brightness, 1)) saturate(var(--spectrum-saturate, 1));
  transition: filter 0.3s ease;
  mask: linear-gradient(
    90deg,
    hsla(0, 0%, 100%, 0) 0,
    hsla(0, 0%, 100%, 0.6) 5%,
    #fff 12%,
    #fff 88%,
    hsla(0, 0%, 100%, 0.6) 95%,
    hsla(0, 0%, 100%, 0)
  );
}
</style>
