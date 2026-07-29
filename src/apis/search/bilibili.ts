import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { bilibili as bilibiliApi } from "@/apis/bilibili";
import type { SearchResult } from "./index";

interface BilibiliSong {
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
  songs?: BilibiliSong[];
}

const songToTrack = (song: BilibiliSong): Track => ({
  id: song.id,
  source: "bilibili",
  title: song.title,
  // B站音频来源不定，多数为 UP 主转码后的有损/16bit FLAC，非真母带，UI 标注
  comment: "非真母带",
  artists: song.artist ? [{ name: song.artist }] : [],
  album: song.album
    ? { name: song.album, cover: song.cover, id: song.albumId }
    : undefined,
  cover: song.cover,
  duration: song.duration ?? 0,
});

const empty = <T>(): SearchResult<T> => ({ items: [], total: 0, hasMore: false });

/**
 * Bilibili 搜索：调用主进程 modules/search.ts
 *
 * 与 archive 之不同：
 * - track.id 是视频 BV 号（如 "BV1xx411c7mD"），一个视频即一个可播放单元
 * - track.comment = "非真母带"：UI 标注 B站音频来源不定，多数非真母带
 * - qualities 仅含 "mp3_128"：B站默认非真母带，UI 标注
 * - 搜索需要 buvid3 cookie（在主进程统一注入）
 */
export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await bilibiliApi.search<SongsResp>({
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
