/**
 * MCP 在线搜索统一适配层
 *
 * 把网易云 / QQ 音乐 / 酷狗的搜索结果归一化为 Track，供 MCP search_online_songs 工具使用。
 * 不走 MusicFree 插件层，直接调用本仓内 apis/* 模块，避免依赖用户已安装的插件。
 */

import { callKugou } from "@main/apis/kugou";
import { callNetease } from "@main/apis/netease";
import { callQQMusic } from "@main/apis/qqmusic";
import type { Track, TrackFee } from "@shared/types/player";
import type { Platform } from "@shared/types/platform";

interface RawArtist {
  id?: number | string;
  name?: string;
}

interface NeteaseSong {
  id: number | string;
  name: string;
  ar?: RawArtist[];
  artists?: RawArtist[];
  al?: { id?: number | string; name?: string; picUrl?: string };
  album?: { id?: number | string; name?: string; picUrl?: string };
  dt?: number;
  duration?: number;
  fee?: number;
  alia?: string[];
  alias?: string[];
}

interface QqMusicSong {
  id: string;
  mid?: string;
  name: string;
  artist?: string;
  album?: string;
  albumMid?: string;
  duration?: number;
}

interface KugouSong {
  id: string;
  hash?: string;
  name: string;
  artist?: string;
  album?: string;
  cover?: string;
  coverOriginal?: string;
  duration?: number;
}

export interface OnlineSearchResult {
  platform: Platform;
  page: number;
  total: number;
  hasMore: boolean;
  tracks: Track[];
}

/** 网易云封面按尺寸拼参（避免重复传 ?param=） */
const sizedNeteaseCover = (url: string | undefined, size: number): string | undefined =>
  url ? `${url}${url.includes("?param=") ? "" : `?param=${size}y${size}`}` : undefined;

/** 网易云 fee 字段映射到内部 TrackFee */
const neteaseFee = (fee: number | undefined): TrackFee | undefined => {
  if (fee === 0 || fee === 8) return 0;
  if (fee === 1) return 1;
  if (fee === 4) return 2;
  return undefined;
};

const neteaseToTrack = (song: NeteaseSong): Track => {
  const album = song.al ?? song.album;
  const artists = song.ar ?? song.artists ?? [];
  const cover = sizedNeteaseCover(album?.picUrl, 300);
  return {
    id: String(song.id),
    source: "netease",
    title: song.name,
    comment: (song.alia ?? song.alias)?.find((item) => item.trim()) || undefined,
    artists: artists.map((artist) => ({
      id: artist.id == null ? undefined : String(artist.id),
      name: artist.name ?? "",
    })),
    album: album?.name
      ? { id: album.id == null ? undefined : String(album.id), name: album.name, cover }
      : undefined,
    duration: song.dt ?? song.duration ?? 0,
    cover,
    coverOriginal: sizedNeteaseCover(album?.picUrl, 1024),
    fee: neteaseFee(song.fee),
  };
};

/** QQ 音乐封面 URL 拼装（mid + 尺寸） */
const qqCover = (mid: string, size: number): string =>
  `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${mid}.jpg`;

const qqMusicToTrack = (song: QqMusicSong): Track => {
  const cover = song.albumMid ? qqCover(song.albumMid, 300) : undefined;
  return {
    id: song.mid || song.id,
    extId: song.mid && song.id !== song.mid ? song.id : undefined,
    source: "qqmusic",
    title: song.name,
    artists: song.artist ? [{ name: song.artist }] : [],
    album: song.album ? { name: song.album, cover } : undefined,
    duration: song.duration ?? 0,
    cover,
    coverOriginal: song.albumMid ? qqCover(song.albumMid, 800) : undefined,
  };
};

const kugouToTrack = (song: KugouSong): Track => ({
  id: song.hash || song.id,
  source: "kugou",
  title: song.name,
  artists: song.artist ? [{ name: song.artist }] : [],
  album: song.album ? { name: song.album, cover: song.cover } : undefined,
  duration: song.duration ?? 0,
  cover: song.cover,
  coverOriginal: song.coverOriginal,
});

const buildResult = (
  platform: Platform,
  page: number,
  limit: number,
  total: number,
  tracks: Track[],
): OnlineSearchResult => ({
  platform,
  page,
  total,
  hasMore: (page - 1) * limit + tracks.length < total,
  tracks,
});

/**
 * 搜索在线平台单曲并转换为可直接播放的 Track
 * @param platform - 在线音乐平台
 * @param query - 搜索关键词
 * @param page - 从 1 开始的页码
 * @param limit - 每页数量
 * @returns 统一搜索结果
 */
export const searchOnlineTracks = async (
  platform: Platform,
  query: string,
  page: number,
  limit: number,
): Promise<OnlineSearchResult> => {
  if (platform === "netease") {
    const { body } = await callNetease("cloudsearch", {
      keywords: query,
      type: 1,
      offset: (page - 1) * limit,
      limit,
    });
    if (body?.code !== 200)
      throw new Error(body?.message ?? body?.msg ?? "Netease search failed");
    const songs = (body?.result?.songs ?? []) as NeteaseSong[];
    return buildResult(
      platform,
      page,
      limit,
      body?.result?.songCount ?? songs.length,
      songs.map(neteaseToTrack),
    );
  }

  if (platform === "qqmusic") {
    const body = (await callQQMusic("search", {
      keywords: query,
      type: 0,
      page,
      limit,
    })) as { code?: number; message?: string; total?: number; songs?: QqMusicSong[] };
    if (body.code !== 200) throw new Error(body.message ?? "QQ Music search failed");
    const songs = body.songs ?? [];
    return buildResult(platform, page, limit, body.total ?? songs.length, songs.map(qqMusicToTrack));
  }

  if (platform === "kugou") {
    const body = (await callKugou("search", { keywords: query, page, limit })) as {
      code?: number;
      message?: string;
      total?: number;
      songs?: KugouSong[];
    };
    if (body.code !== 200) throw new Error(body.message ?? "Kugou search failed");
    const songs = body.songs ?? [];
    return buildResult(platform, page, limit, body.total ?? songs.length, songs.map(kugouToTrack));
  }

  throw new Error(`Unsupported platform: ${platform}`);
};
