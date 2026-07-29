<script setup lang="ts">
/**
 * SParticles 粒子背景
 *
 * 移植自 Inspira UI 的 particles 设计（轻量化版本）：
 * - Canvas 2D 实现浮动的发光粒子
 * - 粒子被鼠标位置轻度吸引，形成"鼠标拖尾"效果
 * - 颜色自动跟随主题主色（rgb(var(--s-primary))）
 *
 * 与 Inspira UI 官方实现差异：
 * - 不依赖 threejs / gsap / @react-three/fiber
 * - 粒子数严格控制（默认 30），适配低端设备（3rd gen i5, 4GB RAM）
 * - 暂停时停止 RAF，节省 CPU
 * - 接入共享 rafScheduler，与 LyricRenderer / PlayerCover 等共用单一 RAF 调度
 *
 * 用法：
 *   <SParticles :count="30" :speed="0.3" />
 */
import { subscribeRaf } from "@/services/rafScheduler";

interface Props {
  /** 粒子数量 */
  count?: number;
  /** 粒子最小半径（px） */
  minRadius?: number;
  /** 粒子最大半径（px） */
  maxRadius?: number;
  /** 粒子运动速度倍率 */
  speed?: number;
  /** 鼠标吸引半径（px） */
  attractRadius?: number;
  /** 鼠标吸引强度（0-1） */
  attractStrength?: number;
  /** 粒子之间连线距离（px，0 关闭） */
  linkDistance?: number;
  /** 是否暂停 */
  paused?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  count: 30,
  minRadius: 1,
  maxRadius: 3,
  speed: 0.3,
  attractRadius: 160,
  attractStrength: 0.04,
  linkDistance: 120,
  paused: false,
});

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
}

const canvasRef = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
/** RAF 订阅取消函数（接入共享 rafScheduler 后取代原 rafId） */
let rafUnsubscribe: (() => void) | null = null;
const mouse = { x: -9999, y: -9999, active: false };

/** 初始化粒子数组 */
const initParticles = (width: number, height: number): void => {
  particles = Array.from({ length: props.count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    vx: (Math.random() - 0.5) * props.speed,
    vy: (Math.random() - 0.5) * props.speed,
    radius: props.minRadius + Math.random() * (props.maxRadius - props.minRadius),
    opacity: 0.3 + Math.random() * 0.5,
  }));
};

/** 读取主题主色 */
const readPrimaryColor = (): [number, number, number] => {
  // rgb(var(--s-primary)) 直接读取 CSS 变量
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--s-primary").trim();
  const parts = raw.split(" ").map((s) => Number.parseFloat(s));
  if (parts.length === 3 && parts.every((n) => !Number.isNaN(n))) {
    return [parts[0], parts[1], parts[2]];
  }
  return [255, 255, 255];
};

/** 单帧渲染（由共享 rafScheduler 调度，节流 33ms ≈ 30fps） */
const render = (): void => {
  if (!ctx || !canvasRef.value) return;
  if (props.paused) {
    stop();
    return;
  }

  const width = canvasRef.value.width;
  const height = canvasRef.value.height;
  ctx.clearRect(0, 0, width, height);

  const [r, g, b] = readPrimaryColor();

  // 更新位置
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    // 边界反弹
    if (p.x < 0 || p.x > width) p.vx *= -1;
    if (p.y < 0 || p.y > height) p.vy *= -1;
    p.x = Math.max(0, Math.min(width, p.x));
    p.y = Math.max(0, Math.min(height, p.y));

    // 鼠标吸引
    if (mouse.active) {
      const dx = mouse.x - p.x;
      const dy = mouse.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist < props.attractRadius && dist > 0.1) {
        const force = props.attractStrength * (1 - dist / props.attractRadius);
        p.vx += (dx / dist) * force;
        p.vy += (dy / dist) * force;
      }
    }

    // 阻尼，防止速度爆炸
    p.vx *= 0.99;
    p.vy *= 0.99;
    // 最低速度：避免完全停止
    const v = Math.hypot(p.vx, p.vy);
    if (v < props.speed * 0.3) {
      p.vx += (Math.random() - 0.5) * 0.01;
      p.vy += (Math.random() - 0.5) * 0.01;
    }
  }

  // 连线（极限性能优化：距离平方比较避免 Math.hypot + 批量 stroke 合并 path）
  if (props.linkDistance > 0) {
    const linkDistSq = props.linkDistance * props.linkDistance;
    const invLinkDist = 1 / props.linkDistance;
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.4)`;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (let i = 0; i < particles.length; i++) {
      const p1 = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < linkDistSq) {
          // 距离越远 alpha 越低，用 globalAlpha 控制单条线透明度
          const dist = Math.sqrt(distSq);
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          // 按 dist/LinkDistance 分桶：避免每条线单独设 strokeStyle（字符串重组开销大）
          // 用 4 档透明度近似，path 仍合并
          const bucket = Math.min(3, Math.floor((dist * invLinkDist) * 4));
          ctx.globalAlpha = (1 - bucket * 0.25) * 0.4;
          ctx.stroke();
          ctx.beginPath();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  // 粒子
  for (const p of particles) {
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.opacity})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
    // 光晕
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.opacity * 0.2})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** 调整 Canvas 尺寸（含 DPR） */
const resizeCanvas = (): void => {
  if (!canvasRef.value) return;
  const parent = canvasRef.value.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvasRef.value.width = rect.width * dpr;
  canvasRef.value.height = rect.height * dpr;
  canvasRef.value.style.width = `${rect.width}px`;
  canvasRef.value.style.height = `${rect.height}px`;
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  initParticles(rect.width, rect.height);
};

const handleMouseMove = (event: MouseEvent): void => {
  if (!canvasRef.value) return;
  const rect = canvasRef.value.getBoundingClientRect();
  mouse.x = event.clientX - rect.left;
  mouse.y = event.clientY - rect.top;
  mouse.active = true;
};

const handleMouseLeave = (): void => {
  mouse.active = false;
};

/** RAF 节流间隔：30fps，粒子运动视觉无差异，降低 50% Canvas 绘制开销 */
const FRAME_INTERVAL = 33;

const start = (): void => {
  if (rafUnsubscribe) return;
  rafUnsubscribe = subscribeRaf(render, FRAME_INTERVAL);
};

const stop = (): void => {
  if (rafUnsubscribe) {
    rafUnsubscribe();
    rafUnsubscribe = null;
  }
};

let resizeObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!canvasRef.value) return;
  ctx = canvasRef.value.getContext("2d");
  if (!ctx) return;
  resizeCanvas();
  start();
  // 使用 ResizeObserver 精准监听 canvas 父容器尺寸变化，避免 window.resize 误触发
  resizeObserver = new ResizeObserver(resizeCanvas);
  resizeObserver.observe(canvasRef.value.parentElement ?? canvasRef.value);
});

onBeforeUnmount(() => {
  stop();
  resizeObserver?.disconnect();
  resizeObserver = null;
});

// 监听 paused 变化
watch(
  () => props.paused,
  (p) => {
    if (p) {
      stop();
    } else {
      start();
    }
  },
);
</script>

<template>
  <canvas
    ref="canvasRef"
    class="s-particles"
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
  />
</template>

<style scoped>
.s-particles {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
  /* 不阻挡下层点击 */
  opacity: 0.85;
}
</style>
