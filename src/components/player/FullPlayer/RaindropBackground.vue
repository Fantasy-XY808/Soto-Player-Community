<script setup lang="ts">
/**
 * 雨滴背景层
 * 参照 BetterLyrics 的 RaindropEffect,使用 Canvas 2D 模拟玻璃上的雨滴粒子
 * 三层渲染:静态水珠(随机散布)+ 滚动水珠(沿 TILT_ANGLE 下滑)+ 拖尾(预生成 4 档 sprite)
 * 每个水珠叠加白色高光(偏左上)模拟球面镜面反射,整体随节拍呼吸轻微放大
 * 拖尾 sprite 一次构建按颜色缓存,避免每帧 createLinearGradient;运动方向通过
 * rotate(π - TILT_ANGLE) 使 sprite 沿 -motion 方向延伸,与原 shader 投影一致
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
/** RAF 节流间隔(ms),20fps 足够雨滴下落,减少 33% 绘制 */
const FRAME_INTERVAL = 50;
/** 渲染缩放:雨滴为细线,0.5x 足够,高 DPI 屏省 75% 像素开销 */
const RENDER_SCALE = 0.5;

/** 静态水珠数量(散布在玻璃上不动,对应 shader StaticRaindrops) */
const STATIC_COUNT = 120;
/** 静态水珠半径范围(px) */
const STATIC_MIN_R = 1.2;
const STATIC_MAX_R = 3.5;
/** 滚动水珠数量(沿 TILT_ANGLE 下滑,对应 shader RollingRaindrops) */
const ROLLING_COUNT = 36;
/** 滚动水珠半径范围(px) */
const ROLLING_MIN_R = 2.5;
const ROLLING_MAX_R = 5;
/** 滚动水珠速度范围(占容器高度/秒) */
const ROLLING_MIN_SPEED = 0.18;
const ROLLING_MAX_SPEED = 0.4;
/** 雨滴倾斜角度(弧度),正值向右下倾斜 */
const TILT_ANGLE = 0.25;
/** 拖尾档位:4 档长度预生成 sprite,避免每帧 createLinearGradient */
const TRAIL_BUCKETS = 4;
/** 拖尾长度范围(px) */
const TRAIL_MIN_LEN = 18;
const TRAIL_MAX_LEN = 56;
/** 拖尾 sprite 宽度(px) */
const TRAIL_SPRITE_W = 2;
/** 拖尾最大不透明度 */
const TRAIL_MAX_ALPHA = 0.55;

interface StaticDrop {
  /** UV 0..1,缩放无关 */
  x: number;
  y: number;
  /** 半径 px */
  r: number;
  /** 主体不透明度 */
  a: number;
}

interface RollingDrop {
  /** 像素坐标 */
  x: number;
  y: number;
  r: number;
  /** 像素/秒,正比于容器高度 */
  speed: number;
  /** 拖尾档位索引 0..TRAIL_BUCKETS-1 */
  trailBucket: number;
  /** 拖尾不透明度乘数,让不同雨滴有差异 */
  trailAlpha: number;
}

const staticDrops = shallowRef<StaticDrop[]>([]);
const rollingDrops = shallowRef<RollingDrop[]>([]);
/** 拖尾 sprite 数组:每档一张离屏 canvas,按当前主色调生成 */
const trailSprites: HTMLCanvasElement[] = [];
/** 当前 sprite 对应的颜色 key,用于检测是否需要重建 */
let spriteColorKey = "";
/** 上一帧时间戳,用于计算 dt；0 表示首帧或刚恢复,首帧 dt 取 0 避免跳跃 */
let lastTimestamp = 0;

/** 创建单档拖尾 sprite:y=0 不透明(贴近雨珠端),y=length 透明(尾端) */
const createTrailSprite = (length: number, color: RGB): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = TRAIL_SPRITE_W;
  c.height = length;
  const cx = c.getContext("2d");
  if (!cx) return c;
  const grad = cx.createLinearGradient(0, 0, 0, length);
  grad.addColorStop(0, `rgba(${color.r}, ${color.g}, ${color.b}, ${TRAIL_MAX_ALPHA})`);
  grad.addColorStop(1, `rgba(${color.r}, ${color.g}, ${color.b}, 0)`);
  cx.fillStyle = grad;
  cx.fillRect(0, 0, TRAIL_SPRITE_W, length);
  return c;
};

/** 重建所有档位拖尾 sprite,按当前主色调 */
const rebuildTrailSprites = (color: RGB): void => {
  trailSprites.length = 0;
  for (let i = 0; i < TRAIL_BUCKETS; i++) {
    const len = TRAIL_MIN_LEN + ((TRAIL_MAX_LEN - TRAIL_MIN_LEN) * i) / (TRAIL_BUCKETS - 1);
    trailSprites.push(createTrailSprite(Math.round(len), color));
  }
};

/** 初始化静态水珠 */
const initStaticDrops = (): void => {
  const result: StaticDrop[] = [];
  for (let i = 0; i < STATIC_COUNT; i++) {
    result.push({
      x: Math.random(),
      y: Math.random(),
      r: STATIC_MIN_R + Math.random() * (STATIC_MAX_R - STATIC_MIN_R),
      a: 0.3 + Math.random() * 0.5,
    });
  }
  staticDrops.value = result;
};

/** 初始化滚动水珠,需要 canvas 像素尺寸用于速度归一 */
const initRollingDrops = (w: number, h: number): void => {
  const result: RollingDrop[] = [];
  for (let i = 0; i < ROLLING_COUNT; i++) {
    const trailLen = TRAIL_MIN_LEN + Math.random() * (TRAIL_MAX_LEN - TRAIL_MIN_LEN);
    const bucket = Math.min(
      TRAIL_BUCKETS - 1,
      Math.max(
        0,
        Math.floor(((trailLen - TRAIL_MIN_LEN) / (TRAIL_MAX_LEN - TRAIL_MIN_LEN)) * TRAIL_BUCKETS),
      ),
    );
    result.push({
      x: Math.random() * w,
      y: Math.random() * h,
      r: ROLLING_MIN_R + Math.random() * (ROLLING_MAX_R - ROLLING_MIN_R),
      speed: (ROLLING_MIN_SPEED + Math.random() * (ROLLING_MAX_SPEED - ROLLING_MIN_SPEED)) * h,
      trailBucket: bucket,
      trailAlpha: 0.6 + Math.random() * 0.4,
    });
  }
  rollingDrops.value = result;
};

/** 绘制单个水珠:半透明主体 + 白色高光(偏左上,模拟球面镜面反射) */
const drawDrop = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  alpha: number,
  color: RGB,
): void => {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = `rgb(${color.r}, ${color.g}, ${color.b})`;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  // 高光:半径 r*0.35,偏左上 r*0.35,白色 alpha*0.7
  ctx.globalAlpha = alpha * 0.7;
  ctx.fillStyle = "rgb(255, 255, 255)";
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
};

/** 绘制单帧 */
const draw = (timestamp: number): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  // 父元素 display:none 时尺寸为 0,跳过绘制
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

  const color = props.dominantColor ?? { r: 180, g: 200, b: 230 };

  // 主色调变化时重建拖尾 sprite(颜色 key 比对避免每帧重建)
  const colorKey = `${color.r},${color.g},${color.b}`;
  if (colorKey !== spriteColorKey) {
    rebuildTrailSprites(color);
    spriteColorKey = colorKey;
  }

  // 滚动水珠依赖像素尺寸,resize 后清空,首帧按当前尺寸初始化
  if (rollingDrops.value.length === 0) {
    initRollingDrops(w, h);
  }

  // 1. 静态水珠层:固定散布,仅随呼吸 scale
  for (const drop of staticDrops.value) {
    drawDrop(ctx, drop.x * w, drop.y * h, drop.r, drop.a, color);
  }

  // 2. 滚动水珠 + 拖尾
  const dt = lastTimestamp === 0 ? 0 : (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  // sprite 旋转角:使 sprite 局部 y 轴沿 -motion 方向延伸(即拖尾朝运动反方向)
  const trailAngle = Math.PI - TILT_ANGLE;
  const moveDx = Math.sin(TILT_ANGLE);
  const moveDy = Math.cos(TILT_ANGLE);

  for (const drop of rollingDrops.value) {
    drop.x += moveDx * drop.speed * dt;
    drop.y += moveDy * drop.speed * dt;
    // 超出底部 + 拖尾长度后从顶部重生,x 随机分布
    const sprite = trailSprites[drop.trailBucket];
    const trailLen = sprite?.height ?? TRAIL_MIN_LEN;
    if (drop.y > h + trailLen) {
      drop.y = -trailLen;
      drop.x = Math.random() * w;
    }

    // 拖尾:用预生成 sprite,旋转后绘制,sprite 顶部不透明端对齐雨珠位置
    if (sprite) {
      ctx.save();
      ctx.globalAlpha = drop.trailAlpha;
      ctx.translate(drop.x, drop.y);
      ctx.rotate(trailAngle);
      ctx.drawImage(sprite, -TRAIL_SPRITE_W / 2, 0);
      ctx.restore();
    }

    // 水珠主体 + 高光(覆盖在拖尾不透明端上,形成"珠头尾拖"视觉)
    drawDrop(ctx, drop.x, drop.y, drop.r, 0.85, color);
  }

  ctx.globalAlpha = 1;
  if (needScale) ctx.restore();
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
  // 滚动水珠位置/速度依赖像素尺寸,resize 后重置
  rollingDrops.value = [];
};

/**
 * 同步可见性:FullPlayer 收起 / 文档隐藏 / 暂停 时取消订阅
 * 文档隐藏由调度器统一处理；这里只需关心 isExpanded + isPlaying
 */
const updateVisibility = (): void => {
  const visible = !document.hidden && status.isExpanded && status.isPlaying;
  if (visible && !unsubscribe) {
    // 重置时间基准,避免恢复时一次性大跳
    lastTimestamp = 0;
    unsubscribe = subscribeRaf(draw, FRAME_INTERVAL);
  } else if (!visible && unsubscribe) {
    unsubscribe();
    unsubscribe = null;
    lastTimestamp = 0;
  }
};

onMounted(() => {
  initStaticDrops();
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
  trailSprites.length = 0;
  spriteColorKey = "";
  lastTimestamp = 0;
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
