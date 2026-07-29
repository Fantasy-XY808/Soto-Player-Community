/**
 * 内置 LyricsEffect 扩展点注册
 *
 * 4 个歌词动画效果：
 * - fade：淡入淡出（opacity 0→1 + transition）
 * - slide：从下方滑入（translateY(20px)→0 + opacity）
 * - scale：缩放进入（scale(0.9)→1 + opacity）
 * - blur：模糊→清晰（filter blur(8px)→0 + opacity）
 *
 * apply 仅在调用时计算 CSS 属性，不修改现有动画引擎代码。
 * LyricsEffectResult.extraCss 为 Record<string, string>，键为 CSS 属性名。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type {
  LyricsEffectDescriptor,
  LyricsEffectContext,
  LyricsEffectResult,
} from "../../../shared/types/plugin-extensions";
import { LyricsEffectRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";

/** 取 number 参数，缺省返回 fallback */
const numParam = (params: Record<string, unknown>, key: string, fallback: number): number => {
  const v = params[key];
  return typeof v === "number" ? v : fallback;
};

/** fade：淡入淡出 */
const applyFade = (_ctx: LyricsEffectContext, params: Record<string, unknown>): LyricsEffectResult => {
  const duration = numParam(params, "duration", 300);
  return {
    opacity: 1,
    extraCss: {
      transition: `opacity ${duration}ms ease`,
    },
  };
};

/** slide：从下方滑入 */
const applySlide = (_ctx: LyricsEffectContext, params: Record<string, unknown>): LyricsEffectResult => {
  const duration = numParam(params, "duration", 300);
  const offset = numParam(params, "offset", 20);
  return {
    transform: `translateY(${offset}px)`,
    opacity: 1,
    extraCss: {
      transition: `transform ${duration}ms ease, opacity ${duration}ms ease`,
    },
  };
};

/** scale：缩放进入 */
const applyScale = (_ctx: LyricsEffectContext, params: Record<string, unknown>): LyricsEffectResult => {
  const duration = numParam(params, "duration", 300);
  const from = numParam(params, "from", 0.9);
  return {
    transform: `scale(${from})`,
    opacity: 1,
    extraCss: {
      transition: `transform ${duration}ms ease, opacity ${duration}ms ease`,
    },
  };
};

/** blur：模糊→清晰 */
const applyBlur = (_ctx: LyricsEffectContext, params: Record<string, unknown>): LyricsEffectResult => {
  const duration = numParam(params, "duration", 300);
  const radius = numParam(params, "radius", 8);
  return {
    filter: `blur(${radius}px)`,
    opacity: 1,
    extraCss: {
      transition: `filter ${duration}ms ease, opacity ${duration}ms ease`,
    },
  };
};

/** 内置 4 套歌词效果元数据 */
interface BuiltinEffectMeta {
  id: string;
  label: string;
  scope: "line" | "char";
  defaultParams: Record<string, number | boolean | string>;
  apply: (ctx: LyricsEffectContext, params: Record<string, unknown>) => LyricsEffectResult;
}

const BUILTIN_EFFECTS: readonly BuiltinEffectMeta[] = [
  {
    id: "fade",
    label: "淡入淡出",
    scope: "line",
    defaultParams: { duration: 300 },
    apply: applyFade,
  },
  {
    id: "slide",
    label: "滑入",
    scope: "line",
    defaultParams: { duration: 300, offset: 20 },
    apply: applySlide,
  },
  {
    id: "scale",
    label: "缩放",
    scope: "line",
    defaultParams: { duration: 300, from: 0.9 },
    apply: applyScale,
  },
  {
    id: "blur",
    label: "模糊",
    scope: "line",
    defaultParams: { duration: 300, radius: 8 },
    apply: applyBlur,
  },
];

/**
 * 注册 4 套内置歌词效果
 *
 * 若某效果已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerLyricsEffects = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_EFFECTS) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (LyricsEffectRegistry.resolveDescriptor(meta.id)) continue;
    const descriptor: LyricsEffectDescriptor = {
      id: meta.id,
      label: meta.label,
      scope: meta.scope,
      defaultParams: meta.defaultParams,
      apply: meta.apply,
    };
    disposables.push(
      LyricsEffectRegistry.register({
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
