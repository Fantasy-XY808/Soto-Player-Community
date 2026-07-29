import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { mora as moraApi } from "@/apis/mora";
import type { SearchResult } from "./index";

interface MoraSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  cover?: string;
  duration: number;
  qualities: string[];
  /** 多品质 hash 字典：hashes["mora-materialNo"] 存 materialNo（供 song_url 模块调 listenDownload 接口） */
  hashes?: Record<string, string>;
}

interface SongsResp {
  total?: number;
  songs?: MoraSong[];
}

const songToTrack = (song: MoraSong): Track => ({
  id: song.id,
  source: "mora",
  title: song.title,
  artists: song.artist ? [{ name: song.artist }] : [],
  album: song.album
    ? { name: song.album, cover: song.cover, id: song.albumId }
    : undefined,
  cover: song.cover,
  duration: song.duration ?? 0,
  hashes: song.hashes,
});

const empty = <T>(): SearchResult<T> => ({ items: [], total: 0, hasMore: false });

/**
 * mora 搜索：调用主进程 modules/search.ts
 *
 * mora 是日本索尼旗下 Hi-Res 商店，搜索 + 试听均免登录：
 * - 搜索接口 GET https://mora.jp/search/getResult?keyWord=xxx 返回最多 10 条综合结果
 * - 试听接口 GET https://mora.jp/listenDownload?materialNo=xxx 返回签名 CloudFront URL
 *
 * - track.id 为 mora materialNo（字符串形式）
 * - track.hashes["mora-materialNo"] 透传到 song_url 模块供 listenDownload 调用
 * - track.qualities 基于 mediaFormatNo / samplingFreq / bitPerSample 推断
 */
export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await moraApi.search<SongsResp>({
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
