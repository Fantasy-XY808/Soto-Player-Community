import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { tidal as tidalApi } from "@/apis/tidal";
import type { SearchResult } from "./index";

interface TidalSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  cover?: string;
  duration: number;
  streamable: boolean;
  maximumBitDepth?: number;
  maximumSamplingRate?: number;
  hirez: boolean;
  qualities: string[];
}

interface SongsResp {
  total?: number;
  songs?: TidalSong[];
}

const songToTrack = (song: TidalSong): Track => ({
  id: song.id,
  source: "tidal",
  title: song.title,
  artists: song.artist ? [{ name: song.artist }] : [],
  album: song.album
    ? { name: song.album, cover: song.cover, id: song.albumId }
    : undefined,
  cover: song.cover,
  duration: song.duration ?? 0,
});

const empty = <T>(): SearchResult<T> => ({ items: [], total: 0, hasMore: false });

/**
 * Tidal 搜索：调用主进程 modules/search.ts
 *
 * 与 Qobuz 之不同：
 * - track.id 是数字字符串（Tidal track id）
 * - 搜索结果带 streamable / maximumBitDepth / maximumSamplingRate / hirez 等音质元数据
 * - 需登录态（access_token 自动注入），无订阅只能拿 30s preview
 */
export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await tidalApi.search<SongsResp>({
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
