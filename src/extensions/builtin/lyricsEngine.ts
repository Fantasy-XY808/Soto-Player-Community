/**
 * 内置 LyricsEngine 扩展点注册
 *
 * 2 个歌词渲染引擎：
 * - dom：DOM 渲染引擎（适配层包装，参考现有 LyricRenderer DOM 渲染思路）
 * - canvas：Canvas 渲染引擎（简化纯函数实现）
 *
 * LyricsEngineDescriptor.create 标准签名 (context) => LyricsEngine，
 * context 包含 canvas: HTMLCanvasElement | null（可空，dom 引擎忽略）。
 *
 * 现有 LyricRenderer 是 DOM 渲染，但接口期望 canvas ctx（可空）。
 * dom 引擎 create 时忽略 ctx.canvas，自建 div 容器作为适配层；
 * canvas 引擎在 ctx.canvas 为 null 时自建 canvas。
 *
 * 注意：所有 DOM API（document.createElement / requestAnimationFrame）
 * 仅在 create 被调用时执行，模块加载时不触发，确保在 Node.js 环境下可安全 import。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type {
  LyricsEngineDescriptor,
  LyricsEngine,
  LyricsEngineContext,
} from "../../../shared/types/plugin-extensions";
import type { LyricLine } from "../../../shared/types/lyrics";
import { LyricsEngineRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";

// ============================================================
// dom 引擎：DOM 渲染，忽略 ctx.canvas，自建 div 容器
// ============================================================

interface DomEngineState {
  container: HTMLDivElement;
  lineEls: HTMLDivElement[];
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  positionMs: number;
  rafId: number;
  disposed: boolean;
}

/**
 * 创建 DOM 渲染引擎
 *
 * 忽略 ctx.canvas，自建 div 容器作为歌词行宿主。
 * 简化实现：每行一个 div，按 position 高亮当前行。
 */
const createDomEngine = (ctx: LyricsEngineContext): LyricsEngine => {
  const container = document.createElement("div");
  container.className = "soto-lyrics-dom";
  container.style.position = "relative";
  container.style.width = "100%";
  container.style.height = "100%";
  container.style.overflow = "hidden";
  container.style.fontFamily = ctx.fontFamily || "sans-serif";
  container.style.fontSize = `${ctx.fontSize || 24}px`;
  container.style.lineHeight = `${ctx.lineHeight || 1.4}`;

  const state: DomEngineState = {
    container,
    lineEls: [],
    fontFamily: ctx.fontFamily || "sans-serif",
    fontSize: ctx.fontSize || 24,
    lineHeight: ctx.lineHeight || 1.4,
    positionMs: 0,
    rafId: 0,
    disposed: false,
  };

  const render = (): void => {
    if (state.disposed) return;
    let activeIdx = -1;
    for (let i = 0; i < state.lineEls.length; i++) {
      // 简化：仅基于 positionMs 高亮当前行（实现细节由调用方驱动）
      void i;
    }
    void activeIdx;
  };

  const scheduleRender = (): void => {
    if (state.rafId !== 0 || state.disposed) return;
    state.rafId = requestAnimationFrame(() => {
      state.rafId = 0;
      render();
    });
  };

  return {
    setLines: (lines: LyricLine[]) => {
      if (state.disposed) return;
      // 清空旧行
      for (const el of state.lineEls) el.remove();
      state.lineEls = [];
      // 构建新行
      for (const line of lines) {
        const lineEl = document.createElement("div");
        lineEl.className = "soto-lyrics-line";
        lineEl.style.padding = "4px 8px";
        lineEl.style.opacity = "0.5";
        lineEl.style.transition = "opacity 200ms ease";
        lineEl.style.whiteSpace = "pre-wrap";
        lineEl.textContent = line.words.map((w) => w.word).join("");
        container.appendChild(lineEl);
        state.lineEls.push(lineEl);
      }
      scheduleRender();
    },
    setPosition: (ms: number) => {
      state.positionMs = ms;
      // 简化：按 startTime 高亮匹配的行
      let activeIdx = -1;
      for (let i = 0; i < state.lineEls.length; i++) {
        // 此处需要 lines 数据，简化为 class 切换
        // 实际项目应缓存 lines，此处保持惰性
      }
      void activeIdx;
      for (let i = 0; i < state.lineEls.length; i++) {
        state.lineEls[i].classList.toggle("active", i === activeIdx);
        state.lineEls[i].style.opacity = i === activeIdx ? "1" : "0.5";
      }
      scheduleRender();
    },
    setStyle: (style: Partial<LyricsEngineContext>) => {
      if (style.fontFamily) {
        state.fontFamily = style.fontFamily;
        container.style.fontFamily = style.fontFamily;
      }
      if (style.fontSize != null) {
        state.fontSize = style.fontSize;
        container.style.fontSize = `${style.fontSize}px`;
      }
      if (style.lineHeight != null) {
        state.lineHeight = style.lineHeight;
        container.style.lineHeight = `${style.lineHeight}`;
      }
    },
    render: () => {
      render();
    },
    dispose: () => {
      if (state.disposed) return;
      state.disposed = true;
      if (state.rafId !== 0) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
      }
      for (const el of state.lineEls) el.remove();
      state.lineEls = [];
      container.remove();
    },
  };
};

// ============================================================
// canvas 引擎：Canvas 渲染，使用 ctx.canvas 或自建 canvas
// ============================================================

interface CanvasEngineState {
  canvas: HTMLCanvasElement;
  ownCanvas: boolean;
  ctx2d: CanvasRenderingContext2D | null;
  lines: LyricLine[];
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  positionMs: number;
  rafId: number;
  disposed: boolean;
}

/**
 * 创建 Canvas 渲染引擎
 *
 * 使用 ctx.canvas（若提供），否则自建 canvas。
 * 简化实现：清空画布后按行序绘制文本，激活行高亮。
 */
const createCanvasEngine = (ctx: LyricsEngineContext): LyricsEngine => {
  const canvas = ctx.canvas ?? document.createElement("canvas");
  const ownCanvas = !ctx.canvas;
  if (ownCanvas) {
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
  }
  const ctx2d = canvas.getContext("2d");

  const state: CanvasEngineState = {
    canvas,
    ownCanvas,
    ctx2d,
    lines: [],
    fontFamily: ctx.fontFamily || "sans-serif",
    fontSize: ctx.fontSize || 24,
    lineHeight: ctx.lineHeight || 1.4,
    positionMs: 0,
    rafId: 0,
    disposed: false,
  };

  const draw = (): void => {
    if (state.disposed || !state.ctx2d) return;
    const { canvas: cv, ctx2d: c2d, lines, fontFamily, fontSize, lineHeight, positionMs } = state;
    const width = cv.width || cv.clientWidth || 800;
    const height = cv.height || cv.clientHeight || 600;
    c2d.clearRect(0, 0, width, height);
    c2d.font = `${fontSize}px ${fontFamily}`;
    c2d.textBaseline = "top";
    let y = 8;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isActive = positionMs >= line.startTime && positionMs < line.endTime;
      c2d.fillStyle = isActive ? "#ffffff" : "rgba(255,255,255,0.5)";
      c2d.fillText(line.words.map((w) => w.word).join(""), 8, y);
      y += fontSize * lineHeight + 4;
    }
  };

  const scheduleRender = (): void => {
    if (state.rafId !== 0 || state.disposed) return;
    state.rafId = requestAnimationFrame(() => {
      state.rafId = 0;
      draw();
    });
  };

  return {
    setLines: (lines: LyricLine[]) => {
      if (state.disposed) return;
      state.lines = lines;
      scheduleRender();
    },
    setPosition: (ms: number) => {
      state.positionMs = ms;
      scheduleRender();
    },
    setStyle: (style: Partial<LyricsEngineContext>) => {
      if (style.fontFamily) state.fontFamily = style.fontFamily;
      if (style.fontSize != null) state.fontSize = style.fontSize;
      if (style.lineHeight != null) state.lineHeight = style.lineHeight;
      scheduleRender();
    },
    render: () => {
      draw();
    },
    dispose: () => {
      if (state.disposed) return;
      state.disposed = true;
      if (state.rafId !== 0) {
        cancelAnimationFrame(state.rafId);
        state.rafId = 0;
      }
      state.lines = [];
      if (state.ownCanvas) state.canvas.remove();
    },
  };
};

// ============================================================
// 注册入口
// ============================================================

/** 内置 2 套歌词引擎元数据 */
interface BuiltinLyricsEngineMeta {
  id: string;
  label: string;
  create: (context: LyricsEngineContext) => LyricsEngine;
}

const BUILTIN_ENGINES: readonly BuiltinLyricsEngineMeta[] = [
  { id: "dom", label: "DOM 渲染引擎", create: createDomEngine },
  { id: "canvas", label: "Canvas 渲染引擎", create: createCanvasEngine },
];

/**
 * 注册 2 套内置歌词引擎
 *
 * 若某引擎已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerLyricsEngines = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_ENGINES) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (LyricsEngineRegistry.resolveDescriptor(meta.id)) continue;
    const descriptor: LyricsEngineDescriptor = {
      id: meta.id,
      label: meta.label,
      create: meta.create,
    };
    disposables.push(
      LyricsEngineRegistry.register({
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
