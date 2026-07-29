/**
 * 内置 LyricsCardStyle 扩展点注册
 *
 * 把 src/utils/lyric/poster.ts 的 4 套样式注册到 LyricsCardStyleRegistry：
 * - classic：经典卡片
 * - compact：紧凑卡片
 * - poster：海报卡片
 * - minimal：极简卡片
 *
 * poster.ts 的 createLyricPoster 返回 Promise<Blob>，render 内将其转为
 * ObjectURL → Image → 绘制到 canvas → 挂载到 container。dispose 时撤销。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type { LyricsCardStyleDescriptor, LyricsCardData } from "../../../shared/types/plugin-extensions";
import type { Track } from "../../../shared/types/player";
import type { LyricLine } from "../../../shared/types/lyrics";
import { LyricsCardStyleRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";
// 注意：poster.ts 使用了 @/ 和 @shared/ 别名，仅在 vite（浏览器）环境可解析。
// 测试通过 tsx 运行无法解析这些别名，因此：
// - 类型用 import type（编译时擦除，不触发运行时解析）
// - createLyricPoster 用动态 import()（仅在 render 调用时加载，测试不调用 render）
import type { LyricCardStyle, LyricPosterLine } from "../../utils/lyric/poster";

/** 内置 4 套歌词卡片样式元数据 */
interface BuiltinStyleMeta {
  id: LyricCardStyle;
  label: string;
  fontFamily: string;
}

const FONT_STACK = '-apple-system, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif';

const BUILTIN_STYLES: readonly BuiltinStyleMeta[] = [
  { id: "classic", label: "经典", fontFamily: FONT_STACK },
  { id: "compact", label: "紧凑", fontFamily: FONT_STACK },
  { id: "poster", label: "海报", fontFamily: FONT_STACK },
  { id: "minimal", label: "极简", fontFamily: FONT_STACK },
];

/** 把 LyricsCardData.lyrics（LyricLine[]）转为 poster 期望的 LyricPosterLine[] */
const toPosterLines = (lines: LyricLine[]): LyricPosterLine[] =>
  lines.map((line) => ({
    text: line.words.map((w) => w.word).join(""),
    translation: line.translatedLyric || undefined,
    romaji: line.romanLyric || undefined,
    duet: line.isDuet,
  }));

/** 从 LyricsCardData 构造最小 Track（供 createLyricPoster 使用） */
const toTrack = (data: LyricsCardData): Track => ({
  id: "lyrics-card-preview",
  source: "streaming",
  title: data.title,
  artists: [{ name: data.artist }],
  album: data.album ? { name: data.album } : undefined,
  cover: data.coverUrl,
  duration: 0,
});

/** 构建单个样式 descriptor */
const buildDescriptor = (meta: BuiltinStyleMeta): LyricsCardStyleDescriptor => ({
  id: meta.id,
  label: meta.label,
  fontFamily: meta.fontFamily,
  render: (container: HTMLElement, data: LyricsCardData): Disposable => {
    const canvas = document.createElement("canvas");
    container.appendChild(canvas);

    let disposed = false;
    let objectUrl: string | null = null;

    // 动态 import：避免在模块加载阶段触发 poster.ts 的 @/ @shared/ 别名解析
    void (async () => {
      try {
        const { createLyricPoster } = await import("../../utils/lyric/poster");
        const blob = await createLyricPoster({
          track: toTrack(data),
          lines: toPosterLines(data.lyrics),
          fallbackColor: data.accentColor ?? null,
          style: meta.id,
        });
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          if (disposed) return;
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0);
        };
        img.src = objectUrl;
      } catch {
        // 忽略绘制错误，dispose 时清理已挂载的 canvas
      }
    })();

    return {
      dispose: () => {
        disposed = true;
        if (objectUrl) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
        }
        canvas.remove();
      },
    };
  },
});

/**
 * 注册 4 套内置歌词卡片样式
 *
 * 若某样式已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerLyricsCardStyles = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_STYLES) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (LyricsCardStyleRegistry.resolveDescriptor(meta.id)) continue;
    disposables.push(
      LyricsCardStyleRegistry.register({
        id: meta.id,
        pluginId: BUILTIN_PLUGIN_ID,
        priority: 0,
        implementation: buildDescriptor(meta),
      }),
    );
  }
  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
};
