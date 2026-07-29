import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { qobuz as qobuzApi } from "@/apis/qobuz";
import type { SearchResult } from "./index";

interface QobuzSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  cover?: string;
  coverOriginal?: string;
  duration: number;
  streamable: boolean;
  previewable: boolean;
  previewUrl?: string;
  maximumBitDepth?: number;
  maximumSamplingRate?: number;
  hirez: boolean;
  qualities: string[];
}

interface SongsResp {
  total?: number;
  songs?: QobuzSong[];
}

const songToTrack = (song: QobuzSong): Track => ({
  id: song.id,
  source: "qobuz",
  title: song.title,
  artists: song.artist ? [{ name: song.artist }] : [],
  album: song.album
    ? { name: song.album, cover: song.cover, id: song.albumId }
    : undefined,
  cover: song.cover,
  coverOriginal: song.coverOriginal,
  duration: song.duration ?? 0,
});

const empty = <T>(): SearchResult<T> => ({ items: [], total: 0, hasMore: false });

/**
 * Qobuz 搜索：调用主进程 modules/search.ts
 *
 * 与 kugou 之不同：
 * - track.id 是数字字符串（Qobuz track id），不是 hash
 * - 搜索结果带 streamable / previewable / maximumBitDepth / maximumSamplingRate 等音质元数据
 * - 公开端点，无鉴权（仅需 X-App-Id header）
 */
export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await qobuzApi.search<SongsResp>({
    keywords: keyword,
    page: Math.floor(offset / limit) + 1,
    limit,
  });
  const items = (body?.songs ?? []).map(songToTrack);
  const total = body?.total ?? items.length;
  return { items, total, hasMore: offset + items.length < total };
};

export const albums = async (
  _keyword: string,
  _offset: number,
  _limit: number,
): Promise<SearchResult<CoverItem>> => empty();
export const artists = async (
  _keyword: string,
  _offset: number,
  _limit: number,
): Promise<SearchResult<CoverItem>> => empty();
export const playlists = async (
  _keyword: string,
  _offset: number,
  _limit: number,
): Promise<SearchResult<CoverItem>> => empty();
