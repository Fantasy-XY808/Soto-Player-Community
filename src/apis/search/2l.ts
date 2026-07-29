import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { twoL as twoLApi } from "@/apis/2l";
import type { SearchResult } from "./index";

interface TwoLSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  cover?: string;
  duration: number;
  qualities: string[];
  /**
   * 直链 hash 字典：search 已抓到 https://www.2l.no/hires/...flac 直链
   * key 固定为 "2l-url"，song_url 模块直接透传返回（2L 是免费样品，无签名无时效）
   */
  hashes?: Record<string, string>;
}

interface SongsResp {
  total?: number;
  songs?: TwoLSong[];
}

const songToTrack = (song: TwoLSong): Track => ({
  id: song.id,
  source: "2l",
  title: song.title,
  // 2L 仅个人试听模式，禁止曲库收录——UI 标注试听限定
  comment: "仅试听，禁止曲库收录",
  artists: song.artist ? [{ name: song.artist }] : [],
  album: song.album
    ? { name: song.album, cover: song.cover, id: song.albumId }
    : undefined,
  cover: song.cover,
  duration: song.duration ?? 0,
  // 透传直链 hash 字典，song_url 模块按 "2l-url" key 取直链返回
  hashes: song.hashes,
});

const empty = <T>(): SearchResult<T> => ({ items: [], total: 0, hasMore: false });

/**
 * 2L 搜索：调用主进程 modules/search.ts
 *
 * 主进程抓 https://www.2l.no/hires/index.html 静态 HTML，正则解析 FLAC/DXD/DSD 直链。
 *
 * - track.id 为 2L 试听曲目 id（"2l-{slugified-title}"）
 * - track.comment = "仅试听，禁止曲库收录"：UI 标注试听限定，禁止加入曲库
 * - track.hashes["2l-url"] 为直链（FLAC 优先，回退 DSF/DFF），song_url 模块直接透传
 * - 默认 qualities 仅含 "flac_24bit_192k"（2L 主打 Hi-Res 24bit/192kHz 与 DSD）
 * - 2L 是免费样品，URL 无签名、无时效，直接可播
 *
 * 注意：2L 官网曾于 2024-2025 期间下线 Test Bench 页面，
 * 届时 search 返回空结果并打日志，待官方恢复后自动恢复解析。
 */
export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await twoLApi.search<SongsResp>({
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
