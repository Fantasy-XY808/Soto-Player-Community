import type { Track, TrackSource } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";
import type { QualityLevel } from "@/utils/quality";
import { useStreamingStore } from "@/stores/streaming";
import { useSettingsStore } from "@/stores/settings";
import { usePluginsStore } from "@/stores/plugins";
import { resolveNeteaseUrl } from "@/apis/song/netease";
import { resolveQQMusicUrl } from "@/apis/song/qqmusic";
import { resolveKugouUrl } from "@/apis/song/kugou";
import { resolveQishuiTrack } from "@/apis/qishui";
import { ErrorCode } from "@shared/types/errors";
import { handleError } from "@/utils/errors";
import { LruCache } from "@/services/lruCache";

const urlCache = new LruCache<string, string>({ capacity: 100, ttl: 5 * 60 * 1000 });

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
 * 检查给定 source 是否走插件源（汽水音乐等无法原生接入的平台）
 * @param source - 要检查的 source
 */
const isPluginOnlySource = (source: string): boolean => source === "qishui";

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
  if (isPluginOnlySource(track.source) && track.id) {
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
  // 汽水音乐走专用插件解析器（无官方接口可用）
  if (isPluginOnlySource(track.source)) {
    const url = await resolveQishuiTrack(track, quality);
    if (url) return { url };
    return fail(ErrorCode.NO_PLUGIN_AVAILABLE);
  }
  if (!isOnlinePlatform(track.source)) return fail(ErrorCode.URL_RESOLVE_FAILED);
  // 插件层不做 VIP clamp：第三方在线 URL 解析源（如 lx-music 类脚本）走自己的鉴权，
  // 不应受网易云官方账号权限限制——否则非 VIP 用户永远拿不到高音质
  // 本地加密文件 (.ncm/.qmc/.kgm/.kgma/.kwm/.mflac/.tm/.qmc0~3/.qmcflac/.tkm)
  // 由 audio-engine 在解码时自动解密（见 native/audio-engine/src/decryptor/），
  // 本函数仅负责在线平台的 URL 解析，不处理本地加密文件
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
 * 关键：官方接口已尝试但返回 null 时，若用户没装插件，报 url_RESOLVE_FAILED
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
  const urlCacheKey = `${track.source}:${track.id}:${songLevel}`;
  const cachedUrl = urlCache.get(urlCacheKey);
  if (cachedUrl) {
    const result: ResolvedTrackSource = { source: cachedUrl, fromCache: false };
    if (cacheEnabled) {
      result.cacheRequest = async () => {
        void window.api.cache.song.fetch(cacheKey, track.source, cachedUrl);
      };
    }
    return result;
  }
  // 流媒体
  if (track.source === "streaming") {
    try {
      const store = useStreamingStore();
      const streamUrl = await store.getStreamUrl(track);
      urlCache.set(urlCacheKey, streamUrl);
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
      urlCache.set(urlCacheKey, url);
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
  // 插件源（汽水音乐等无法原生接入的平台）
  if (isPluginOnlySource(track.source)) {
    try {
      const resolved = await resolveByPlugin(track, songLevel);
      if (resolved.url === null) {
        handleError(resolved.errorCode);
        return null;
      }
      const url = resolved.url;
      urlCache.set(urlCacheKey, url);
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

/**
 * 确保曲目有可分析的本地缓存路径
 * - 本地文件直接返回 path
 * - 流媒体 / 在线 / 插件源：复用 songCache 落盘后返回本地绝对路径
 *   （Rust 分析器依赖可 seek 的本地源；流媒体 URL 多需鉴权 header，无法直接喂给引擎）
 * @param track - 曲目
 * @returns 本地文件绝对路径；缓存未启用或下载失败时返回 null
 */
export const ensureLocalCachePath = async (track: Track): Promise<string | null> => {
  if (track.source === "local") return track.path ?? null;
  const settings = useSettingsStore();
  const songLevel = settings.player.songLevel;
  const cacheKey = cacheKeyForTrack(track, songLevel);
  // 无 cacheKey 或未启用歌曲缓存：无法本地化
  if (!cacheKey || settings.system.cache?.songCache?.enabled !== true) return null;
  // 命中本地缓存直接返回
  const cached = await window.api.cache.song.lookup(cacheKey);
  if (cached) return cached;
  // 未命中：解析 URL 后触发下载
  const resolved = await resolveTrackSource(track);
  if (!resolved) return null;
  if (resolved.fromCache) return resolved.source;
  if (resolved.cacheRequest) {
    await resolved.cacheRequest();
    // 下载完成后再次 lookup 取本地路径
    return await window.api.cache.song.lookup(cacheKey);
  }
  // 走到这里说明缓存未启用但又拿到 URL：流媒体鉴权 URL 无法直接喂给分析器
  return null;
};