/**
 * 插件元数据兜底编排
 *
 * 内置平台拿不到歌词/封面时，由此向声明了 getLyric / getMusicInfo 的 MusicFree 插件源兜底：
 * 先 search 出候选，复用 pickBestCandidate（时长硬门槛）匹配，再 getLyric / getMusicInfo 取数据
 *
 * 与 dr-190 fork 的差异：
 * - Soto_Player 没有 musicSearch / musicLyric / musicPic 这三个独立 action，
 *   统一走 MusicFree 协议下的 search / getLyric / getMusicInfo
 * - getMusicInfo 返回 musicItem.artwork 作为封面 URL
 */

import type { Track } from "@shared/types/player";
import type { MfMusicItem, MfQualityKey } from "@shared/types/plugin";
import { pluginRegistry, type PluginRuntime } from "./registry";
import { mfGetLyric, mfGetMusicInfo, mfSearch } from "./router";
import { pickBestCandidate, type LyricCandidate } from "@main/apis/common/lyric/utils";
import { pluginLog } from "@main/utils/logger";

/** 在线平台 source → MusicFree 插件源 key；与 audioSource 的映射保持一致 */
const PLATFORM_TO_PLUGIN_SOURCE: Record<string, string> = {
  netease: "wy",
  qqmusic: "tx",
  kugou: "kg",
};

/** 兜底取歌词/封面的请求参数 */
export interface PluginMatchLyricArgs {
  pluginId: string;
  source: string;
  track: Track;
}

export interface PluginMatchCoverArgs {
  pluginId: string;
  source: string;
  track: Track;
}

/** 兜底取歌词的返回结构 */
export interface PluginMatchLyricResult {
  lyric?: string;
  rawLrc?: string;
  translation?: string;
}

/** 兜底取封面的返回结构 */
export interface PluginMatchCoverResult {
  url?: string;
}

/**
 * 在某插件源里定位与 track 对应的 MfMusicItem
 *
 * 同源（track 平台映射后 == source）直接用 track.id 省一次搜索；
 * 否则 search + 时长门槛打分（pickBestCandidate）
 *
 * @returns 匹配中的候选；无命中返回 null
 */
const findMatch = async (
  rt: PluginRuntime,
  source: string,
  track: Track,
): Promise<MfMusicItem | null> => {
  // 同源直接构造候选，省一次 search
  if (PLATFORM_TO_PLUGIN_SOURCE[track.source] === source && track.id) {
    return {
      id: track.id,
      platform: source,
      title: track.title,
      artist: track.artists.map((artist) => artist.name).join("/"),
      album: track.album?.name,
      duration: track.duration,
    };
  }
  const keyword = `${track.title} ${track.artists.map((artist) => artist.name).join(" ")}`.trim();
  if (!keyword) return null;
  const res = await mfSearch(rt.manifest.id, keyword, 1, "music");
  const list = (res?.data ?? []) as MfMusicItem[];
  if (list.length === 0) return null;
  const candidates: LyricCandidate<MfMusicItem>[] = list.map((item) => ({
    name: item.title ?? "",
    artist: item.artist ?? "",
    album: item.album,
    duration: item.duration,
    extra: item,
  }));
  return pickBestCandidate(candidates, track)?.extra ?? null;
};

/**
 * 经某插件源兜底取歌词
 *
 * @param args - pluginId / source / track
 * @returns 命中的歌词；无匹配 / 无歌词 / 出错均返回 null（调用方据此尝试下一个源）
 */
export const matchLyric = async (args: PluginMatchLyricArgs): Promise<PluginMatchLyricResult | null> => {
  const rt = pluginRegistry.getRuntime(args.pluginId);
  if (!rt || rt.status.state !== "ready") return null;
  try {
    const musicInfo = await findMatch(rt, args.source, args.track);
    if (!musicInfo) return null;
    const lyric = await mfGetLyric(rt.manifest.id, musicInfo);
    if (!lyric?.lrc && !lyric?.rawLrc) return null;
    return {
      lyric: lyric.lrc,
      rawLrc: lyric.rawLrc,
      translation: lyric.translation,
    };
  } catch (err) {
    pluginLog.warn(
      "matchLyric failed",
      args.pluginId,
      args.source,
      (err as Error)?.message,
    );
    return null;
  }
};

/**
 * 经某插件源兜底取封面
 *
 * 优先用 search 结果里 MfMusicItem.artwork；缺失时再调 getMusicInfo 取一次
 *
 * @param args - pluginId / source / track
 * @returns 命中的封面 URL；无匹配 / 无封面 / 出错均返回 null（调用方据此尝试下一个源）
 */
export const matchCover = async (args: PluginMatchCoverArgs): Promise<PluginMatchCoverResult | null> => {
  const rt = pluginRegistry.getRuntime(args.pluginId);
  if (!rt || rt.status.state !== "ready") return null;
  try {
    const musicInfo = await findMatch(rt, args.source, args.track);
    if (!musicInfo) return null;
    // search 结果里通常已带 artwork；缺时调 getMusicInfo 补
    let artwork = musicInfo.artwork;
    if (!artwork) {
      const info = await mfGetMusicInfo(rt.manifest.id, {
        id: musicInfo.id,
        platform: musicInfo.platform ?? args.source,
      });
      artwork = info?.musicItem?.artwork;
    }
    return artwork ? { url: artwork } : null;
  } catch (err) {
    pluginLog.warn(
      "matchCover failed",
      args.pluginId,
      args.source,
      (err as Error)?.message,
    );
    return null;
  }
};

/**
 * 枚举声明了 getLyric 能力的插件源（用于歌词兜底编排）
 *
 * @returns 数组项为 `{ pluginId, source }`，调用方按顺序串行 matchLyric 直到命中
 */
export const listLyricFallbackSources = (): Array<{ pluginId: string; source: string }> => {
  const out: Array<{ pluginId: string; source: string }> = [];
  for (const info of pluginRegistry.listInfo()) {
    if (!info.enabled || info.status.state !== "ready") continue;
    const sources = info.status.sources ?? {};
    for (const [sourceKey, cap] of Object.entries(sources)) {
      if (cap?.actions.includes("getLyric")) {
        out.push({ pluginId: info.manifest.id, source: sourceKey });
      }
    }
  }
  return out;
};

/**
 * 枚举声明了 getMusicInfo 能力的插件源（用于封面兜底编排）
 *
 * @returns 数组项为 `{ pluginId, source }`，调用方按顺序串行 matchCover 直到命中
 */
export const listCoverFallbackSources = (): Array<{ pluginId: string; source: string }> => {
  const out: Array<{ pluginId: string; source: string }> = [];
  for (const info of pluginRegistry.listInfo()) {
    if (!info.enabled || info.status.state !== "ready") continue;
    const sources = info.status.sources ?? {};
    for (const [sourceKey, cap] of Object.entries(sources)) {
      if (cap?.actions.includes("getMusicInfo")) {
        out.push({ pluginId: info.manifest.id, source: sourceKey });
      }
    }
  }
  return out;
};

/** 兼容外部调用：取首个可用音质档位（用于 resolveUrl 兜底，本文件未直接使用） */
export const pickQuality = (qualities: MfQualityKey[] | undefined): MfQualityKey =>
  qualities?.[0] ?? "standard";
