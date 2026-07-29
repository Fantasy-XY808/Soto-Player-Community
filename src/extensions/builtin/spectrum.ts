/**
 * 内置 SpectrumStyle 扩展点注册
 *
 * 3 个频谱样式：
 * - bottom-bars：底部柱状频谱（参考 BottomSpectrum.vue drawBars）
 * - bottom-curve：底部曲线频谱（参考 BottomSpectrum.vue drawCurve）
 * - around-radial：环绕封面径向频谱（参考 AroundCoverSpectrum.vue drawRadialBar）
 *
 * Vue 文件内的绘制函数针对立体声 + DPR + RAF 节流做了复杂优化，
 * 此处为符合 SpectrumStyleDescriptor.render 标准签名 (ctx, data, options) 的简化纯函数实现，
 * 接收单声道 Uint8Array 数据，不修改原 Vue 文件。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type {
  SpectrumStyleDescriptor,
  SpectrumRenderOptions,
} from "../../../shared/types/plugin-extensions";
import { SpectrumStyleRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";

/**
 * 底部柱状频谱绘制
 *
 * 沿宽度方向从左到右绘制 barCount 个柱条，高度由对应 FFT bin 的值驱动。
 * 参考 BottomSpectrum.vue drawBars，简化为单声道全宽布局。
 */
const drawBars = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  options: SpectrumRenderOptions,
): void => {
  const { width, height, barCount, sensitivity, glow, color } = options;
  if (barCount <= 0 || data.length === 0) return;
  const barWidth = width / barCount;
  const gap = barWidth * 0.2;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  if (glow) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
  }
  for (let i = 0; i < barCount; i++) {
    const dataIdx = Math.floor((i / barCount) * data.length);
    const value = (data[dataIdx] / 255) * sensitivity;
    const barHeight = value * height;
    if (barHeight <= 0.5) continue;
    const x = i * barWidth + gap / 2;
    const y = height - barHeight;
    ctx.fillRect(x, y, barWidth - gap, barHeight);
  }
  ctx.shadowBlur = 0;
};

/**
 * 底部曲线频谱绘制
 *
 * 用 Catmull-Rom 样条平滑连接 barCount 个采样点，闭合到底边填充。
 * 参考 BottomSpectrum.vue drawCurve，简化为单声道全宽布局。
 */
const drawCurve = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  options: SpectrumRenderOptions,
): void => {
  const { width, height, barCount, sensitivity, glow, color } = options;
  if (barCount < 2 || data.length === 0) return;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (glow) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
  }

  // 构造采样点
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < barCount; i++) {
    const dataIdx = Math.floor((i / barCount) * data.length);
    const value = (data[dataIdx] / 255) * sensitivity;
    const x = (i / (barCount - 1)) * width;
    const y = height - value * height;
    points.push({ x, y });
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  // Catmull-Rom 转 cubic Bezier
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
  ctx.lineTo(points[points.length - 1].x, height);
  ctx.lineTo(points[0].x, height);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
};

/**
 * 环绕封面径向频谱绘制
 *
 * 以画布中心为圆心，沿圆周分布 barCount 个径向条。
 * 参考 AroundCoverSpectrum.vue drawRadialBar，使用线段绘制（Vue 用扇形片段，此处简化）。
 */
const drawRadialBar = (
  ctx: CanvasRenderingContext2D,
  data: Uint8Array,
  options: SpectrumRenderOptions,
): void => {
  const { width, height, barCount, sensitivity, glow, color } = options;
  if (barCount <= 0 || data.length === 0) return;
  const cx = width / 2;
  const cy = height / 2;
  const innerRadius = Math.min(width, height) * 0.3;
  const maxBarLength = Math.min(width, height) * 0.2;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  if (glow) {
    ctx.shadowBlur = 8;
    ctx.shadowColor = color;
  }
  for (let i = 0; i < barCount; i++) {
    const dataIdx = Math.floor((i / barCount) * data.length);
    const value = (data[dataIdx] / 255) * sensitivity;
    const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2;
    const barLength = value * maxBarLength;
    if (barLength <= 0.5) continue;
    const x1 = cx + Math.cos(angle) * innerRadius;
    const y1 = cy + Math.sin(angle) * innerRadius;
    const x2 = cx + Math.cos(angle) * (innerRadius + barLength);
    const y2 = cy + Math.sin(angle) * (innerRadius + barLength);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
};

/** 内置 3 套频谱样式元数据 */
interface BuiltinSpectrumMeta {
  id: string;
  label: string;
  render: (ctx: CanvasRenderingContext2D, data: Uint8Array, options: SpectrumRenderOptions) => void;
}

const BUILTIN_STYLES: readonly BuiltinSpectrumMeta[] = [
  { id: "bottom-bars", label: "底部柱状", render: drawBars },
  { id: "bottom-curve", label: "底部曲线", render: drawCurve },
  { id: "around-radial", label: "环绕径向", render: drawRadialBar },
];

/**
 * 注册 3 套内置频谱样式
 *
 * 若某样式已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerSpectrumStyles = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_STYLES) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (SpectrumStyleRegistry.resolveDescriptor(meta.id)) continue;
    const descriptor: SpectrumStyleDescriptor = {
      id: meta.id,
      label: meta.label,
      render: meta.render,
    };
    disposables.push(
      SpectrumStyleRegistry.register({
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
