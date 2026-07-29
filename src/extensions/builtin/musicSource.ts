/**
 * 内置 MusicSource 扩展点注册
 *
 * 10 个平台音源（与 src/services/audioSource.ts 后端支持一致）：
 * - netease：网易云音乐
 * - qqmusic：QQ 音乐
 * - kugou：酷狗音乐
 * - qobuz：Qobuz（Hi-Res 母带）
 * - tidal：Tidal（16bit FLAC / 24bit MQA）
 * - archive：Internet Archive
 * - mora：mora（日本索尼 Hi-Res 商店）
 * - prostudiomasters：ProStudioMasters（专业母带商店）
 * - 2l：2L（挪威 Hi-Res 厂牌）
 * - bilibili：B 站
 *
 * search 包装 src/apis/search/index.ts 的 searchSongs
 * resolveUrl 包装各平台的 resolveXxxUrl
 *
 * 注意：本注册仅作为"扩展点目录"展示，不替代现有播放链路。
 * 现有 coverLoader/lyricResolve 调插件 action 的旧链路保留不动（双轨）。
 *
 * 类型适配：
 * - MusicSourceDescriptor.resolveUrl 返回 Promise<string>，而底层 resolveXxxUrl
 *   返回 Promise<string | null>（null 表示无版权/VIP 限制）。此处把 null 归一为 ""，
 *   让描述符签名符合规范；调用方需自行判断空串并回落。
 * - MusicSourceDescriptor.resolveUrl 第二参 quality: string，底层各平台签名不同
 *   （netease 接 QualityLevel，kugou 接 options.quality，archive 接 songLevel，
 *   其余平台忽略 quality 参数），此处按平台分别适配。
 * - MusicSourceDescriptor.search 为可选字段；所有 10 个平台均通过 searchSongs
 *   注册搜索能力。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type { MusicSourceDescriptor } from "../../../shared/types/plugin-extensions";
import type { Track } from "../../../shared/types/player";
import type { QualityLevel } from "../../utils/quality";
import type { Platform } from "../../../shared/types/platform";
import { MusicSourceRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";
import { searchSongs } from "../../apis/search";
import { resolveNeteaseUrl as resolveNeteaseUrlImpl } from "../../apis/song/netease";
import { resolveQQMusicUrl as resolveQQMusicUrlImpl } from "../../apis/song/qqmusic";
import { resolveKugouUrl as resolveKugouUrlImpl } from "../../apis/song/kugou";
import { resolveArchiveUrl as resolveArchiveUrlImpl } from "../../apis/song/archive";
import { resolveQobuzUrl as resolveQobuzUrlImpl } from "../../apis/song/qobuz";
import { resolveTidalUrl as resolveTidalUrlImpl } from "../../apis/song/tidal";
import { resolveMoraUrl as resolveMoraUrlImpl } from "../../apis/song/mora";
import { resolveProstudiomastersUrl as resolveProstudiomastersUrlImpl } from "../../apis/song/prostudiomasters";
import { resolve2LUrl as resolve2LUrlImpl } from "../../apis/song/2l";
import { resolveBilibiliUrl as resolveBilibiliUrlImpl } from "../../apis/song/bilibili";

/** 搜索分页大小（与现有 search UI 默认一致） */
const PAGE_SIZE = 20;

/**
 * 创建平台搜索包装器
 *
 * searchSongs 接收 offset/limit，描述符要求 page（1-based），
 * 转换：offset = (page - 1) * PAGE_SIZE
 */
const createSearchWrapper = (
  platform: Platform,
): ((keyword: string, page: number) => Promise<{ total: number; items: Track[] }>) => {
  return async (keyword: string, page: number): Promise<{ total: number; items: Track[] }> => {
    const res = await searchSongs(platform, keyword, (page - 1) * PAGE_SIZE, PAGE_SIZE);
    return { total: res.total, items: res.items };
  };
};

/**
 * 网易云 URL 解析包装
 *
 * 底层 resolveNeteaseUrl 接收 (track, songLevel: QualityLevel, forceSource?)，
 * 描述符 quality: string 强转为 QualityLevel。forceSource 不暴露（走默认 auto 调度）。
 */
const resolveNeteaseUrl = async (track: Track, quality?: string): Promise<string> => {
  const url = await resolveNeteaseUrlImpl(track, quality as QualityLevel);
  return url ?? "";
};

/**
 * QQ 音乐 URL 解析包装
 *
 * 底层 resolveQQMusicUrl 接收 (track, options?: { withCredentials? })，
 * 描述符 quality 参数对 QQ 音乐无意义（QQ 音质由 cookie/VIP 决定），忽略。
 */
const resolveQqmusicUrl = async (track: Track, _quality?: string): Promise<string> => {
  const url = await resolveQQMusicUrlImpl(track);
  return url ?? "";
};

/**
 * 酷狗 URL 解析包装
 *
 * 底层 resolveKugouUrl 接收 (track, options?: { withCredentials?, quality? })，
 * 描述符 quality: string 强转为 QualityLevel 透传给 options.quality。
 */
const resolveKugouUrl = async (track: Track, quality?: string): Promise<string> => {
  const url = await resolveKugouUrlImpl(track, { quality: quality as QualityLevel | undefined });
  return url ?? "";
};

/**
 * Archive URL 解析包装
 *
 * 底层 resolveArchiveUrl 接收 (track, songLevel?: QualityLevel)，
 * 描述符 quality: string 强转为 QualityLevel 透传给 songLevel。
 */
const resolveArchiveUrl = async (track: Track, quality?: string): Promise<string> => {
  const url = await resolveArchiveUrlImpl(track, quality as QualityLevel | undefined);
  return url ?? "";
};

/** 内置音源元数据 */
interface BuiltinMusicSourceMeta {
  id: string;
  label: string;
  search?: (keyword: string, page: number) => Promise<{ total: number; items: Track[] }>;
  resolveUrl: (track: Track, quality?: string) => Promise<string>;
}

const BUILTIN_SOURCES: readonly BuiltinMusicSourceMeta[] = [
  {
    id: "netease",
    label: "网易云音乐",
    search: createSearchWrapper("netease"),
    resolveUrl: resolveNeteaseUrl,
  },
  {
    id: "qqmusic",
    label: "QQ 音乐",
    search: createSearchWrapper("qqmusic"),
    resolveUrl: resolveQqmusicUrl,
  },
  {
    id: "kugou",
    label: "酷狗音乐",
    search: createSearchWrapper("kugou"),
    resolveUrl: resolveKugouUrl,
  },
  {
    id: "qobuz",
    label: "Qobuz",
    search: createSearchWrapper("qobuz"),
    resolveUrl: async (track): Promise<string> => (await resolveQobuzUrlImpl(track)) ?? "",
  },
  {
    id: "tidal",
    label: "Tidal",
    search: createSearchWrapper("tidal"),
    resolveUrl: async (track): Promise<string> => (await resolveTidalUrlImpl(track)) ?? "",
  },
  {
    id: "archive",
    label: "Archive",
    search: createSearchWrapper("archive"),
    resolveUrl: resolveArchiveUrl,
  },
  {
    id: "mora",
    label: "mora",
    search: createSearchWrapper("mora"),
    resolveUrl: async (track): Promise<string> => (await resolveMoraUrlImpl(track)) ?? "",
  },
  {
    id: "prostudiomasters",
    label: "ProStudioMasters",
    search: createSearchWrapper("prostudiomasters"),
    resolveUrl: async (track): Promise<string> => (await resolveProstudiomastersUrlImpl(track)) ?? "",
  },
  {
    id: "2l",
    label: "2L",
    search: createSearchWrapper("2l"),
    resolveUrl: async (track): Promise<string> => (await resolve2LUrlImpl(track)) ?? "",
  },
  {
    id: "bilibili",
    label: "B站",
    search: createSearchWrapper("bilibili"),
    resolveUrl: async (track): Promise<string> => (await resolveBilibiliUrlImpl(track)) ?? "",
  },
];

/**
 * 注册全部内置音源
 *
 * 若某音源已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerMusicSources = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_SOURCES) {
    // 跳过已注册的条目，支持 registerBuiltinExtensions 重复调用
    if (MusicSourceRegistry.resolveDescriptor(meta.id)) continue;
    const descriptor: MusicSourceDescriptor = {
      id: meta.id,
      label: meta.label,
      search: meta.search,
      resolveUrl: meta.resolveUrl,
    };
    disposables.push(
      MusicSourceRegistry.register({
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
