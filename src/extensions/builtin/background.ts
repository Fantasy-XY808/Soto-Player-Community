/**
 * 内置 BackgroundOverlay 扩展点注册
 *
 * 3 个背景叠加：
 * - fog：雾气背景（参考 FogBackground.vue，简化为粒子径向渐变）
 * - snow：雪花背景（参考 SnowBackground.vue，简化为向下飘落的圆点）
 * - raindrop：雨滴背景（参考 RaindropBackground.vue，简化为快速下落的线段）
 *
 * Vue 文件内的绘制针对 fbm 噪声 / 距离场 / 拖尾 sprite 做了复杂优化，
 * 此处为符合 BackgroundOverlayDescriptor.create 标准签名 (container) => BackgroundOverlay 的简化纯函数实现，
 * 接收 container HTMLElement，返回 { setPalette?, setBassEnergy?, dispose }，
 * 不修改原 Vue 文件。
 *
 * 注意：所有 DOM API（document.createElement / requestAnimationFrame / window.addEventListener）
 * 仅在 create 被调用时执行，模块加载时不触发，确保在 Node.js 环境下可安全 import。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type {
  BackgroundOverlayDescriptor,
  BackgroundOverlay,
} from "../../../shared/types/plugin-extensions";
import { BackgroundOverlayRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";

// ============================================================
// fog 背景：径向渐变粒子，缓慢漂移
// ============================================================

interface FogParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
}

const createFog = (container: HTMLElement): BackgroundOverlay => {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let rafId = 0;
  let disposed = false;
  let palette: string[] = ["#1a1a2e", "#16213e"];
  let bassEnergy = 0;
  const particles: FogParticle[] = [];

  const resize = (): void => {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
  };
  resize();

  const initParticles = (): void => {
    particles.length = 0;
    for (let i = 0; i < 30; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: 80 + Math.random() * 120,
        alpha: 0.05 + Math.random() * 0.1,
      });
    }
  };
  initParticles();

  const render = (): void => {
    if (disposed || !ctx) return;
    ctx.fillStyle = palette[0] ?? "#1a1a2e";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    for (const p of particles) {
      p.x += p.vx * (1 + bassEnergy * 2);
      p.y += p.vy * (1 + bassEnergy * 2);
      if (p.x < -p.size) p.x = canvas.width + p.size;
      if (p.x > canvas.width + p.size) p.x = -p.size;
      if (p.y < -p.size) p.y = canvas.height + p.size;
      if (p.y > canvas.height + p.size) p.y = -p.size;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      const alphaHex = Math.floor(Math.max(0, Math.min(1, p.alpha)) * 255)
        .toString(16)
        .padStart(2, "0");
      grad.addColorStop(0, `${palette[1] ?? "#16213e"}${alphaHex}`);
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
    }
    rafId = requestAnimationFrame(render);
  };
  render();

  window.addEventListener("resize", resize);

  return {
    setPalette: (colors: string[]) => {
      palette = colors;
    },
    setBassEnergy: (e: number) => {
      bassEnergy = e;
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      canvas.remove();
    },
  };
};

// ============================================================
// snow 背景：圆点向下飘落
// ============================================================

interface Snowflake {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
}

const createSnow = (container: HTMLElement): BackgroundOverlay => {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let rafId = 0;
  let disposed = false;
  let palette: string[] = ["#0a0a1a", "#ffffff"];
  let bassEnergy = 0;
  const flakes: Snowflake[] = [];

  const resize = (): void => {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
  };
  resize();

  const initFlakes = (): void => {
    flakes.length = 0;
    for (let i = 0; i < 80; i++) {
      flakes.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: 0.5 + Math.random() * 1.5,
        size: 1 + Math.random() * 3,
        alpha: 0.5 + Math.random() * 0.5,
      });
    }
  };
  initFlakes();

  const render = (): void => {
    if (disposed || !ctx) return;
    ctx.fillStyle = palette[0] ?? "#0a0a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = palette[1] ?? "#ffffff";
    for (const f of flakes) {
      f.x += f.vx * (1 + bassEnergy);
      f.y += f.vy * (1 + bassEnergy);
      if (f.y > canvas.height) {
        f.y = -f.size;
        f.x = Math.random() * canvas.width;
      }
      if (f.x < 0) f.x = canvas.width;
      if (f.x > canvas.width) f.x = 0;
      ctx.globalAlpha = f.alpha;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    rafId = requestAnimationFrame(render);
  };
  render();

  window.addEventListener("resize", resize);

  return {
    setPalette: (colors: string[]) => {
      palette = colors;
    },
    setBassEnergy: (e: number) => {
      bassEnergy = e;
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      canvas.remove();
    },
  };
};

// ============================================================
// raindrop 背景：线段快速下落
// ============================================================

interface Raindrop {
  x: number;
  y: number;
  length: number;
  speed: number;
  alpha: number;
}

const createRaindrop = (container: HTMLElement): BackgroundOverlay => {
  const canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  let rafId = 0;
  let disposed = false;
  let palette: string[] = ["#0a0a1a", "#88aacc"];
  let bassEnergy = 0;
  const drops: Raindrop[] = [];

  const resize = (): void => {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
  };
  resize();

  const initDrops = (): void => {
    drops.length = 0;
    for (let i = 0; i < 100; i++) {
      drops.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        length: 10 + Math.random() * 20,
        speed: 5 + Math.random() * 10,
        alpha: 0.3 + Math.random() * 0.4,
      });
    }
  };
  initDrops();

  const render = (): void => {
    if (disposed || !ctx) return;
    ctx.fillStyle = palette[0] ?? "#0a0a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = palette[1] ?? "#88aacc";
    ctx.lineWidth = 1;
    for (const d of drops) {
      d.y += d.speed * (1 + bassEnergy);
      if (d.y > canvas.height) {
        d.y = -d.length;
        d.x = Math.random() * canvas.width;
      }
      ctx.globalAlpha = d.alpha;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x, d.y + d.length);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    rafId = requestAnimationFrame(render);
  };
  render();

  window.addEventListener("resize", resize);

  return {
    setPalette: (colors: string[]) => {
      palette = colors;
    },
    setBassEnergy: (e: number) => {
      bassEnergy = e;
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      canvas.remove();
    },
  };
};

// ============================================================
// 注册入口
// ============================================================

/** 内置 3 套背景叠加元数据 */
interface BuiltinBackgroundMeta {
  id: string;
  label: string;
  create: (container: HTMLElement) => BackgroundOverlay;
}

const BUILTIN_BACKGROUNDS: readonly BuiltinBackgroundMeta[] = [
  { id: "fog", label: "雾气", create: createFog },
  { id: "snow", label: "雪花", create: createSnow },
  { id: "raindrop", label: "雨滴", create: createRaindrop },
];

/**
 * 注册 3 套内置背景叠加
 *
 * 若某背景已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerBackgroundOverlays = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_BACKGROUNDS) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (BackgroundOverlayRegistry.resolveDescriptor(meta.id)) continue;
    const descriptor: BackgroundOverlayDescriptor = {
      id: meta.id,
      label: meta.label,
      create: meta.create,
    };
    disposables.push(
      BackgroundOverlayRegistry.register({
        id: meta.id,
        pluginId: BUILTIN_PLUGIN_ID,
        priority: 0,
        implementation: descriptor,
      }),
    );
  }
  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
};
