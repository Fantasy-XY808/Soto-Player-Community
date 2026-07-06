/**
 * WebGL 背景特效基础设施
 *
 * 提供共享的 GPU 像素着色器管线,用于把 BetterLyrics 系列 HLSL 着色器 1:1 移植到 GLSL。
 * 单一入口负责:GL 上下文创建 / shader 编译 / program 链接 / uniform 注入 / 共享 RAF 调度 /
 * canvas resize / 资源释放。调用方只需提供 fragment shader 源码与每帧 uniform 函数。
 *
 * 标准 uniform 自动注入(调用方无需手动传):
 * - uTime (float): 单调递增秒时间,从 start 起算
 * - uResolution (vec2): canvas 像素尺寸
 * - uColor1~uColor4 (vec3): palette[0..3] 归一化到 0~1,不足补默认色
 * - uBass (float): 节拍呼吸 scale(useBreathing 1.0~1.08,直接传 scale 让 shader 自处理)
 *
 * 调用方通过 uniforms() 返回的自定义 uniform 会与标准 uniform 合并(后者可被覆盖)。
 * 共享 RAF 调度复用 subscribeRaf,visibilitychange / window blur 已由调度器统一处理;
 * enabled=false 时主动 stop,RAF 不再分发回调。
 */

import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { RGB } from "@/utils/palette";
import { subscribeRaf } from "@/services/rafScheduler";
import { useBreathing } from "@/composables/useBreathing";

/** 顶点着色器:固定全屏 quad,attribute aPos ∈ [-1,1] */
const VERT_SHADER = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

/** palette 不足 4 色时的兜底色(与原 Canvas 2D 实现一致) */
const DEFAULT_PALETTE: RGB[] = [
  { r: 120, g: 80, b: 160 },
  { r: 80, g: 120, b: 200 },
  { r: 160, g: 80, b: 120 },
  { r: 100, g: 140, b: 180 },
];

/** 帧间隔默认值:30fps 与后端 FFT 推送对齐 */
const DEFAULT_FRAME_INTERVAL = 32;

/** uniform 值类型:number=scalar,数组按长度推断 vec/mat */
export type UniformValue = number | number[] | Float32Array;

export interface ShaderBackgroundOptions {
  /** GLSL ES 1.0 fragment shader 源码(不含 precision 声明,composable 自动补) */
  fragmentShader: string;
  /** 每帧更新的自定义 uniform;返回值会与标准 uniform 合并 */
  uniforms?: () => Record<string, UniformValue>;
  /** 启用开关:false 时停止 RAF 但保留 GL 资源,可再次 start */
  enabled: Ref<boolean>;
  /** 调色板,自动注入 uColor1~4 */
  palette: Ref<RGB[]>;
  /** 目标帧间隔(ms),0 表示每帧;默认 32ms ≈ 30fps */
  frameInterval?: number;
  /** 渲染缩放:canvas 实际像素 = CSS 像素 * dpr * scale;默认 1.0 全分辨率 */
  renderScale?: number;
}

export interface UseBackgroundShaderReturn {
  /** 启动 RAF(幂等) */
  start: () => void;
  /** 停止 RAF(幂等) */
  stop: () => void;
  /** 是否正在渲染 */
  isRunning: Ref<boolean>;
  /** WebGL 是否可用;false 时调用方应回退到 Canvas 2D */
  isWebGLSupported: boolean;
}

/**
 * 编译单个 shader
 * @param gl - GL 上下文
 * @param type - gl.VERTEX_SHADER / gl.FRAGMENT_SHADER
 * @param src - GLSL 源码
 * @returns 编译后的 shader,失败抛错
 */
const compileShader = (gl: WebGLRenderingContext, type: number, src: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("createShader 失败");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "unknown";
    gl.deleteShader(shader);
    throw new Error(`shader 编译失败: ${log}`);
  }
  return shader;
};

/**
 * 创建并链接 program
 * @param gl - GL 上下文
 * @param fragSrc - fragment shader 源码
 * @returns { program, vbo, locCache }
 */
const createProgram = (gl: WebGLRenderingContext, fragSrc: string) => {
  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram 失败");
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) || "unknown";
    gl.deleteProgram(program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    throw new Error(`program 链接失败: ${log}`);
  }
  // 顶点着色器编译后即可删除(驱动已内化)
  gl.deleteShader(vert);
  gl.deleteShader(frag);

  // 全屏 quad:两个三角形覆盖 NDC [-1,1]
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(program, "aPos");
  if (aPos >= 0) {
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  }

  return { program, vbo, aPosLoc: aPos };
};

/**
 * 写入单个 uniform,根据值类型推断 setter
 */
const setUniform = (
  gl: WebGLRenderingContext,
  loc: WebGLUniformLocation | null,
  value: UniformValue,
): void => {
  if (loc === null) return;
  if (typeof value === "number") {
    gl.uniform1f(loc, value);
    return;
  }
  const arr = value instanceof Float32Array ? value : new Float32Array(value);
  switch (arr.length) {
    case 1:
      gl.uniform1fv(loc, arr);
      break;
    case 2:
      gl.uniform2fv(loc, arr);
      break;
    case 3:
      gl.uniform3fv(loc, arr);
      break;
    case 4:
      gl.uniform4fv(loc, arr);
      break;
    case 9:
      gl.uniformMatrix3fv(loc, false, arr);
      break;
    case 16:
      gl.uniformMatrix4fv(loc, false, arr);
      break;
  }
};

/**
 * RGB → [0,1] vec3
 */
const rgbToVec3 = (c: RGB): [number, number, number] => [c.r / 255, c.g / 255, c.b / 255];

/**
 * 取 palette 第 i 色,不足补 DEFAULT_PALETTE
 */
const pickColor = (palette: RGB[], i: number): RGB => palette[i] ?? DEFAULT_PALETTE[i] ?? DEFAULT_PALETTE[0];

/**
 * WebGL 背景着色器 composable
 *
 * 在 setup scope 内自动释放资源:onScopeDispose 时 stop + deleteProgram + loseContext。
 * enabled=false 时 stop RAF 但保留 GL 资源;再次 enabled=true 时 start 即可恢复。
 *
 * @param canvasRef - canvas 元素 ref
 * @param options - 配置
 * @returns start / stop / isRunning / isWebGLSupported
 */
export function useBackgroundShader(
  canvasRef: Ref<HTMLCanvasElement | null>,
  options: ShaderBackgroundOptions,
): UseBackgroundShaderReturn {
  const { fragmentShader, uniforms, enabled, palette, frameInterval = DEFAULT_FRAME_INTERVAL, renderScale = 1.0 } = options;
  const { scale } = useBreathing();

  const isRunning = ref(false);
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let vbo: WebGLBuffer | null = null;
  let loseCtx: WEBGL_lose_context | null = null;
  let unsubscribe: (() => void) | null = null;
  let resizeObserver: ResizeObserver | null = null;
  /** uniform location 缓存:key=name,值=WebGLUniformLocation|null */
  const locCache = new Map<string, WebGLUniformLocation | null>();
  /** 起始时间戳(ms),用于 uTime 累加 */
  let startTime = 0;
  /** canvas 实际像素尺寸,与 uniform 同步 */
  let pixelW = 0;
  let pixelH = 0;

  /** WebGL 是否可用;canvas 不存在或 getContext 返回 null 时为 false */
  const isWebGLSupported = (() => {
    if (typeof document === "undefined") return false;
    const probe = document.createElement("canvas");
    const ctx = probe.getContext("webgl") || probe.getContext("experimental-webgl");
    return !!ctx;
  })();

  /** 取 uniform location,带缓存 */
  const getLoc = (name: string): WebGLUniformLocation | null => {
    if (!program) return null;
    if (locCache.has(name)) return locCache.get(name) ?? null;
    const loc = gl!.getUniformLocation(program, name);
    locCache.set(name, loc);
    return loc;
  };

  /** 编译并链接 program */
  const initProgram = (): void => {
    const canvas = canvasRef.value;
    if (!canvas || !isWebGLSupported) return;
    const ctx = canvas.getContext("webgl", {
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
      alpha: true,
    });
    if (!ctx) return;
    gl = ctx as WebGLRenderingContext;
    loseCtx = gl.getExtension("WEBGL_lose_context");
    // fragment shader 头部补 precision 与版本声明
    const fragSrc = `precision mediump float;\n${fragmentShader}`;
    const built = createProgram(gl, fragSrc);
    program = built.program;
    vbo = built.vbo;
  };

  /** 调整 canvas 像素尺寸:CSS 像素 * dpr * renderScale */
  const resize = (): void => {
    const canvas = canvasRef.value;
    if (!canvas || !gl) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const cssW = parent.clientWidth;
    const cssH = parent.clientHeight;
    if (cssW === 0 || cssH === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const newW = Math.max(1, Math.round(cssW * dpr * renderScale));
    const newH = Math.max(1, Math.round(cssH * dpr * renderScale));
    if (newW === pixelW && newH === pixelH) return;
    pixelW = newW;
    pixelH = newH;
    canvas.width = newW;
    canvas.height = newH;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    // viewport 失效时机:context resize / 程序启动 / 可见性恢复
    gl.viewport(0, 0, newW, newH);
  };

  /** 绘制单帧 */
  const draw = (now: number): void => {
    if (!gl || !program) return;
    if (pixelW === 0 || pixelH === 0) resize();
    if (pixelW === 0 || pixelH === 0) return;

    // 标准 uniform
    const t = (now - startTime) / 1000;
    setUniform(gl, getLoc("uTime"), t);
    setUniform(gl, getLoc("uResolution"), [pixelW, pixelH]);
    setUniform(gl, getLoc("uBass"), scale.value);
    const pal = palette.value;
    setUniform(gl, getLoc("uColor1"), rgbToVec3(pickColor(pal, 0)));
    setUniform(gl, getLoc("uColor2"), rgbToVec3(pickColor(pal, 1)));
    setUniform(gl, getLoc("uColor3"), rgbToVec3(pickColor(pal, 2)));
    setUniform(gl, getLoc("uColor4"), rgbToVec3(pickColor(pal, 3)));

    // 自定义 uniform(可覆盖标准 uniform)
    if (uniforms) {
      const custom = uniforms();
      for (const key in custom) {
        setUniform(gl, getLoc(key), custom[key]);
      }
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  /** 启动 RAF(幂等) */
  const start = (): void => {
    if (!isWebGLSupported) return;
    if (isRunning.value) return;
    if (!program) initProgram();
    if (!gl || !program) return;
    startTime = performance.now();
    resize();
    unsubscribe = subscribeRaf(draw, frameInterval);
    isRunning.value = true;
  };

  /** 停止 RAF(幂等) */
  const stop = (): void => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    isRunning.value = false;
  };

  /** 释放 GL 资源(program / vbo / context) */
  const dispose = (): void => {
    stop();
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (gl) {
      if (vbo) gl.deleteBuffer(vbo);
      if (program) gl.deleteProgram(program);
      vbo = null;
      program = null;
      locCache.clear();
      if (loseCtx) loseCtx.loseContext();
      gl = null;
      loseCtx = null;
    }
  };

  // enabled 联动:外层 v-if 已挂载组件时,enabled false→true 直接 start
  watch(
    enabled,
    (val) => {
      if (val) start();
      else stop();
    },
    { immediate: false },
  );

  // canvas 挂载后初始化 + 监听 resize
  const installCanvas = (canvas: HTMLCanvasElement | null): void => {
    if (!canvas) return;
    if (!gl) initProgram();
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => resize());
      if (canvas.parentElement) resizeObserver.observe(canvas.parentElement);
    }
    if (enabled.value) start();
  };

  watch(canvasRef, installCanvas, { immediate: true });

  onScopeDispose(dispose);

  return { start, stop, isRunning, isWebGLSupported };
}