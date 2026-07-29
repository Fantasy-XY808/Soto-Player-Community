/**
 * 内置 LayoutProfile 扩展点注册
 *
 * 4 套播放页布局配置：
 * - standard：标准布局（封面左 + 歌词右）
 * - stacked：堆叠布局（封面上 + 歌词下，对应 FullPlayer isStacked）
 * - cover-focused：封面居中大图（对应 fullscreenCover）
 * - minimal：极简布局（仅歌词，封面缩小至顶栏）
 *
 * 对应 FullPlayer/index.vue 中现有的 boolean 切换：
 * - isStacked（窄窗口/纵长比）
 * - fullscreenCover（settings.player.coverLayout === "fullscreen"）
 * - coverCentered（autoCenterCover + 无可显示歌词）
 * - mirrorEffective（mirrorLayout）
 *
 * 此处按 LayoutProfile 网格描述符（rowDefinitions/columnDefinitions/placements）建模，
 * 不修改 FullPlayer/index.vue，仅作为扩展点目录存在（双轨保留）。
 *
 * 类型说明（shared/types/plugin-extensions.ts 实际类型）：
 * - LayoutProfile.mode 是 number（非 LyricsWindowMode 联合类型），用 0/1/2/3 标识布局枚举
 * - ComponentPlacement.componentType 是 ComponentType 联合（"AlbumArt"|"Lyrics"|...），非 "component"
 * - ComponentPlacement 含完整网格属性：row/column/rowSpan/columnSpan/margins/alignment/width/height
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type {
  LayoutProfile,
  ComponentPlacement,
  ComponentType,
} from "../../../shared/types/plugin-extensions";
import { LayoutProfileRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";

/** 构造 ComponentPlacement 的辅助函数，缺省字段填 0 / "Stretch" */
const place = (
  componentType: ComponentType,
  row: number,
  column: number,
  overrides: Partial<ComponentPlacement> = {},
): ComponentPlacement => ({
  componentType,
  row,
  column,
  rowSpan: 1,
  columnSpan: 1,
  marginLeft: 0,
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  horizontalAlignment: "Stretch",
  verticalAlignment: "Stretch",
  width: 0,
  height: 0,
  ...overrides,
});

/** 内置 4 套布局元数据 */
interface BuiltinLayoutMeta {
  id: string;
  name: string;
  mode: number;
  rowDefinitions: string[];
  columnDefinitions: string[];
  placements: ComponentPlacement[];
}

const BUILTIN_LAYOUTS: readonly BuiltinLayoutMeta[] = [
  {
    id: "standard",
    name: "标准布局",
    mode: 0,
    rowDefinitions: ["1fr"],
    columnDefinitions: ["2fr", "3fr"],
    placements: [
      place("AlbumArt", 0, 0, { horizontalAlignment: "Center", verticalAlignment: "Center" }),
      place("Lyrics", 0, 1, { horizontalAlignment: "Stretch", verticalAlignment: "Stretch" }),
    ],
  },
  {
    id: "stacked",
    name: "堆叠布局",
    mode: 1,
    rowDefinitions: ["1fr", "1fr"],
    columnDefinitions: ["1fr"],
    placements: [
      place("AlbumArt", 0, 0, { horizontalAlignment: "Center", verticalAlignment: "Center" }),
      place("Lyrics", 1, 0, { horizontalAlignment: "Stretch", verticalAlignment: "Stretch" }),
    ],
  },
  {
    id: "cover-focused",
    name: "封面居中",
    mode: 2,
    rowDefinitions: ["1fr"],
    columnDefinitions: ["3fr", "2fr"],
    placements: [
      place("AlbumArt", 0, 0, {
        horizontalAlignment: "Center",
        verticalAlignment: "Center",
        columnSpan: 2,
      }),
      place("SongTitle", 0, 1, { horizontalAlignment: "Left", verticalAlignment: "Bottom" }),
    ],
  },
  {
    id: "minimal",
    name: "极简布局",
    mode: 3,
    rowDefinitions: ["auto", "1fr"],
    columnDefinitions: ["1fr"],
    placements: [
      place("AlbumArt", 0, 0, {
        horizontalAlignment: "Center",
        verticalAlignment: "Center",
        width: 120,
        height: 120,
      }),
      place("Lyrics", 1, 0, { horizontalAlignment: "Stretch", verticalAlignment: "Stretch" }),
    ],
  },
];

/**
 * 注册 4 套内置布局配置
 *
 * 若某布局已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerLayoutProfiles = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_LAYOUTS) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (LayoutProfileRegistry.resolveDescriptor(meta.id)) continue;
    const profile: LayoutProfile = {
      id: meta.id,
      mode: meta.mode,
      name: meta.name,
      rowDefinitions: meta.rowDefinitions,
      columnDefinitions: meta.columnDefinitions,
      rowSpacing: 0,
      columnSpacing: 0,
      paddingLeft: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      placements: meta.placements,
    };
    disposables.push(
      LayoutProfileRegistry.register({
        id: meta.id,
        pluginId: BUILTIN_PLUGIN_ID,
        priority: 0,
        implementation: profile,
      }),
    );
  }
  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
};
