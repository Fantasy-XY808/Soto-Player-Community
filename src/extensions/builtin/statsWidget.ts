/**
 * 内置 StatsWidget 扩展点注册
 *
 * 3 个统计小部件：
 * - play-count：播放次数统计
 * - playtime：播放时长统计
 * - recent-tracks：最近播放
 *
 * component 字段类型为 unknown，此处用 null 占位（实际渲染由 Vue 层后续接入），
 * 避免在注册阶段引入 Vue 依赖。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type { StatsWidgetDescriptor } from "../../../shared/types/plugin-extensions";
import { StatsWidgetRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";

/** 内置统计小部件元数据 */
interface BuiltinStatsWidgetMeta {
  id: string;
  label: string;
  defaultRowSpan: number;
  defaultColumnSpan: number;
}

const BUILTIN_WIDGETS: readonly BuiltinStatsWidgetMeta[] = [
  { id: "play-count", label: "播放次数", defaultRowSpan: 1, defaultColumnSpan: 1 },
  { id: "playtime", label: "播放时长", defaultRowSpan: 1, defaultColumnSpan: 1 },
  { id: "recent-tracks", label: "最近播放", defaultRowSpan: 2, defaultColumnSpan: 2 },
];

/**
 * 注册内置统计小部件
 *
 * 若某条目已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerStatsWidgets = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_WIDGETS) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (StatsWidgetRegistry.resolveDescriptor(meta.id)) continue;
    const descriptor: StatsWidgetDescriptor = {
      id: meta.id,
      label: meta.label,
      defaultRowSpan: meta.defaultRowSpan,
      defaultColumnSpan: meta.defaultColumnSpan,
      component: null,
    };
    disposables.push(
      StatsWidgetRegistry.register({
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
