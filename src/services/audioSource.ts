import type { Track, TrackSource } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { QualityLevel } from "@/utils/quality";
import { useStreamingStore } from "@/stores/streaming";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { resolveNeteaseUrl } from "@/apis/song/netease";
import { resolveQQMusicUrl } from "@/apis/song/qqmusic";
import { resolveKugouUrl } from "@/apis/song/kugou";
import { ErrorCode } from "@shared/types/errors";
import { handleError } from "@/utils/errors";

/** 在线平台 source → 插件 source key */
const PLATFORM_TO_PLUGIN_SOURCE: Record<Platform, string> = {
  netease: "wy",
  qqmusic: "tx",
  kugou: "kg",
};

/**
 * 检查给定 source 是否为在线平台
 * @param source - 要检查的 source
 */
const isOnlinePlatform = (source: TrackSource): source is Platform =>
  source === "netease" || source === "qqmusic" || source === "kugou";

/**
 * 派生缓存键
 * netease 把音质档位并入键，使不同音质的同一首歌互不覆盖
 * @param track - 要解析的 track
 * @param songLevel - 在线歌曲音质档位
 * @returns 派生缓存键，如果该 track 不参与歌曲缓存则返回 null
 */
const cacheKeyForTrack = (track: Track, songLevel: QualityLevel): string | null => {
  if (track.source === "streaming" && track.serverId && track.originalId) {
    return `s:${track.serverId}:${track.originalId}:`;
  }
  if (track.source === "netease" && track.id) {
    return `o:netease:${track.id}:${songLevel}`;
  }
  if (isOnlinePlatform(track.source) && track.id) {
    return `o:${track.source}:${track.id}:`;
  }
  return null;
};

/** 在线 URL 解析结果 */
export type OnlineResolveResult = { url: string } | { url: null; errorCode: ErrorCode };

/**
 * 经插件解析在线音频源 URL
 * @param track - 要解析的 track
 * @param quality - 音质档位（播放默认 hq，下载传下载档位）
 * @returns 解析结果，失败时带原因码
 */
export const resolveByPlugin = async (
  track: Track,
  quality: QualityLevel = "hq",
): Promise<OnlineResolveResult> => {
  const fail = (errorCode: ErrorCode): OnlineResolveResult => ({ url: null, errorCode });
  if (!isOnlinePlatform(track.source)) return fail(ErrorCode.URL_RESOLVE_FAILED);
  // 插件层不做 VIP clamp：第三方在线 URL 解析源（如 lx-music 类脚本）走自己的鉴权，
  // 不应受网易云官方账号权限限制——否则非 VIP 用户永远拿不到高音质
  // 注意：本项目不支持 unlock-music 类本地解密（解密 .ncm/.qmc 等加密文件），
  // 那是另一类工具，工作时机是"下载后本地解密"，与本项目"在线播放实时鉴权"完全不同
  const pluginSource = PLATFORM_TO_PLUGIN_SOURCE[track.source];
  if (!pluginSource) return fail(ErrorCode.URL_RESOLVE_FAILED);
  const plugins = usePluginsStore();
  const candidates = plugins.list.filter(
    (info) =>
      info.enabled &&
      info.status.state === "ready" &&
      info.status.sources[pluginSource]?.actions.includes("musicUrl"),
  );
  if (candidates.length === 0) return fail(ErrorCode.NO_PLUGIN_AVAILABLE);
  // MusicInfoBase 形状；id / songmid / songId 三种别名都给，兼容不同年代脚本
  const totalSec = track.duration > 0 ? Math.round(track.duration / 1000) : 0;
  const interval =
    totalSec > 0
      ? `${Math.floor(totalSec / 60)
          .toString()
          .padStart(2, "0")}:${(totalSec % 60).toString().padStart(2, "0")}`
      : null;
  const singer = track.artists.map((artist) => artist.name).join("/");
  const musicInfo = {
    id: track.id,
    songmid: track.id,
    songId: track.id,
    name: track.title,
    singer,
    source: pluginSource,
    interval,
    meta: {
      songId: track.id,
      albumName: track.album?.name ?? "",
      albumId: track.album?.id,
      picUrl: track.cover ?? null,
    },
  };
  for (const plugin of candidates) {
    try {
      const res = await window.api.plugins.resolveUrl({
        pluginId: plugin.manifest.id,
        source: pluginSource,
        quality,
        musicInfo,
      });
      if (res?.url) return { url: res.url };
    } catch (err) {
      console.warn("[plugin] resolveUrl failed", plugin.manifest.id, err);
    }
  }
  return { url: null, errorCode: ErrorCode.URL_RESOLVE_FAILED };
};

/**
 * 解析在线音频源 URL
 * 三个平台都先走官方接口（匿名态拿 128k），失败 / 无版权再回落插件。
 * 关键：官方接口已尝试但返回 null 时，若用户没装插件，报 URL_RESOLVE_FAILED
 * 而不是 NO_PLUGIN_AVAILABLE —— "未找到插件"文案对"VIP/版权无法播放"场景是误导。
 * @param track - 要解析的 track
 * @param songLevel - 在线歌曲音质档位（仅网易云官方接口生效）
 */
const resolveOnlineUrl = async (
  track: Track,
  songLevel: QualityLevel,
): Promise<OnlineResolveResult> => {
  let officialTried = false;
  try {
    if (track.source === "netease") {
      officialTried = true;
      const resolved = await resolveNeteaseUrl(track, songLevel);
      if (resolved) return { url: resolved };
    } else if (track.source === "qqmusic") {
      officialTried = true;
      const resolved = await resolveQQMusicUrl(track);
      if (resolved) return { url: resolved };
    } else if (track.source === "kugou") {
      officialTried = true;
      const resolved = await resolveKugouUrl(track);
      if (resolved) return { url: resolved };
    }
  } catch {
    // 官方 API 异常回落插件
  }
  // 官方接口已尝试但无 URL：若用户没装可用插件，直接报 URL_RESOLVE_FAILED，
  // 避免"未找到支持该平台的插件"对 VIP / 版权 / 网络异常场景的误导
  if (officialTried && isOnlinePlatform(track.source)) {
    const pluginSource = PLATFORM_TO_PLUGIN_SOURCE[track.source];
    const plugins = usePluginsStore();
    const hasPlugin = plugins.list.some(
      (info) =>
        info.enabled &&
        info.status.state === "ready" &&
        info.status.sources[pluginSource]?.actions.includes("musicUrl"),
    );
    if (!hasPlugin) return { url: null, errorCode: ErrorCode.URL_RESOLVE_FAILED };
  }
  // 透传 songLevel 给插件层，插件层会再做权限 clamp
  return resolveByPlugin(track, songLevel);
};

/**
 * 解析结果
 * - fromCache 为 true 时表示音源直接命中本地缓存
 * - cacheRequest 存在时表示尚未缓存，调用方应在合适时机（如播放达到阈值后）触发它
 */
export interface ResolvedTrackSource {
  source: string;
  fromCache: boolean;
  cacheRequest?: () => Promise<void>;
}

/**
 * 根据 track 信息解析出最终的音频源 URL
 * @param track - 要解析的 track
 */
export const resolveTrackSource = async (track: Track): Promise<ResolvedTrackSource | null> => {
  // 本地文件
  if (track.source === "local") {
    return track.path ? { source: track.path, fromCache: false } : null;
  }
  const settings = useSettingsStore();
  const songLevel = settings.player.songLevel;
  const cacheKey = cacheKeyForTrack(track, songLevel);
  const cacheEnabled = settings.system.cache?.songCache?.enabled === true && cacheKey !== null;
  if (cacheEnabled) {
    const cached = await window.api.cache.song.lookup(cacheKey!);
    if (cached) return { source: cached, fromCache: true };
  }
  // 流媒体
  if (track.source === "streaming") {
    try {
      const store = useStreamingStore();
      const streamUrl = await store.getStreamUrl(track);
      const result: ResolvedTrackSource = { source: streamUrl, fromCache: false };
      if (cacheEnabled) {
        // 缓存下载用独立 PlaySessionId
        result.cacheRequest = async () => {
          try {
            const cacheUrl = await store.getStreamUrl(track, {
              playSessionId: crypto.randomUUID(),
            });
            void window.api.cache.song.fetch(cacheKey, "streaming", cacheUrl);
          } catch (err) {
            console.warn("[cache] streaming getStreamUrl failed", err);
          }
        };
      }
      return result;
    } catch (err) {
      handleError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }
  // 在线源（netease / qqmusic / kugou）
  if (isOnlinePlatform(track.source)) {
    try {
      const resolved = await resolveOnlineUrl(track, songLevel);
      if (resolved.url === null) {
        handleError(resolved.errorCode);
        return null;
      }
      const url = resolved.url;
      const result: ResolvedTrackSource = { source: url, fromCache: false };
      if (cacheEnabled) {
        result.cacheRequest = async () => {
          void window.api.cache.song.fetch(cacheKey, track.source, url);
        };
      }
      return result;
    } catch (err) {
      handleError(err instanceof Error ? err.message : String(err));
      return null;
    }
  }
  return null;
};
