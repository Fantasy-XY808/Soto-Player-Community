/**
 * 内置 LyricsSource 扩展点注册
 *
 * 2 个歌词源：
 * - netease：网易云歌词
 * - qqmusic：QQ 音乐歌词
 *
 * search 包装 window.api.lyrics.matchByQuery IPC，按 title/artist 模糊搜索歌词，
 * 命中后用 parseLyric 解析为 LyricLine[]；未命中或异常返回 null。
 *
 * 注意：本注册仅作为"扩展点目录"展示，不替代现有 lyricResolve/lyricLoader 兜底链。
 * 现有 lyricLoader.fetchFromPlatform 链路保留不动（双轨）。
 *
 * 渲染端 IPC 入口：window.api.lyrics.matchByQuery(platform, track)
 * 返回 LyricMatchResponse = { ok: true, data: LyricMatchResult | null } | { ok: false, error }
 * LyricMatchResult extends LyricInput，含 content/translation/romaji + format/platform
 *
 * 模块加载安全：window 引用仅在 search 函数体内（运行时调用），模块顶层无 window 引用，
 * 确保 Node.js 测试环境可安全 import。parseLyric 用动态 import 延迟加载，避免测试时
 * 触发 parse.ts 内 @shared 别名解析。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type { LyricsSourceDescriptor } from "../../../shared/types/plugin-extensions";
import type { Track } from "../../../shared/types/player";
import type { LyricLine } from "../../../shared/types/lyrics";
import { LyricsSourceRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";

/** LyricsSourceDescriptor.search 的查询参数 */
interface LyricsQuery {
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

/**
 * 把 LyricsQuery 构造为 Track，供 matchByQuery 使用
 *
 * source 设为 "local"（非目标平台），强制 matchByQuery 走模糊搜索而非 byId 精确匹配。
 * id 留空字符串，byQuery 模式不使用 id。
 */
const queryToTrack = (query: LyricsQuery): Track => ({
  id: "",
  source: "local",
  title: query.title,
  artists: [{ name: query.artist }],
  album: query.album ? { name: query.album } : undefined,
  duration: query.duration ?? 0,
});

/**
 * 在指定平台搜索歌词
 *
 * @param platform 目标平台（netease / qqmusic）
 * @param query 查询参数
 * @returns 解析后的 LyricLine[]，未命中或异常返回 null
 */
const searchOnPlatform = async (
  platform: "netease" | "qqmusic",
  query: LyricsQuery,
): Promise<LyricLine[] | null> => {
  try {
    const track = queryToTrack(query);
    const resp = await window.api?.lyrics?.matchByQuery?.(platform, track);
    if (!resp?.ok || !resp.data) return null;
    const data = resp.data;
    // 动态 import 延迟加载 parseLyric，避免测试时触发 @shared 别名解析
    const { parseLyric } = await import("../../utils/lyric/parse");
    return parseLyric(data, data.format);
  } catch {
    return null;
  }
};

/** 内置 2 个歌词源元数据 */
interface BuiltinLyricsSourceMeta {
  id: string;
  label: string;
  search: (query: LyricsQuery) => Promise<LyricLine[] | null>;
}

const BUILTIN_SOURCES: readonly BuiltinLyricsSourceMeta[] = [
  { id: "netease", label: "网易云音乐歌词", search: (q) => searchOnPlatform("netease", q) },
  { id: "qqmusic", label: "QQ 音乐歌词", search: (q) => searchOnPlatform("qqmusic", q) },
];

/**
 * 注册 2 个内置歌词源
 *
 * 若某歌词源已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerLyricsSources = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_SOURCES) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (LyricsSourceRegistry.resolveDescriptor(meta.id)) continue;
    const descriptor: LyricsSourceDescriptor = {
      id: meta.id,
      label: meta.label,
      search: meta.search,
    };
    disposables.push(
      LyricsSourceRegistry.register({
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
