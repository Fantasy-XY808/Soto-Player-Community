import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { archive as archiveApi } from "@/apis/archive";
import type { SearchResult } from "./index";

interface ArchiveSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  cover?: string;
  duration: number;
  qualities: string[];
}

interface SongsResp {
  total?: number;
  songs?: ArchiveSong[];
}

const songToTrack = (song: ArchiveSong): Track => ({
  id: song.id,
  source: "archive",
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
 * Internet Archive 搜索：调用主进程 modules/search.ts
 *
 * 与 Qobuz 之不同：
 * - track.id 是 archive.org identifier（如 "GratefulDead-1972-..."），一场演出的标识符
 * - 搜索结果不带 streamable / previewable / maximumBitDepth 等音质元数据
 * - 公开端点，完全无鉴权
 * - 默认 qualities 仅含 "mp3_320"（etree 集合现场录音主要派生格式）
 */
export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await archiveApi.search<SongsResp>({
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
