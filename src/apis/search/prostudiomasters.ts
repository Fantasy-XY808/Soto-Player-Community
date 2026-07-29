import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import { prostudiomasters as psmApi } from "@/apis/prostudiomasters";
import type { SearchResult } from "./index";

interface PsmSong {
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
  songs?: PsmSong[];
}

const songToTrack = (song: PsmSong): Track => ({
  id: song.id,
  source: "prostudiomasters",
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
 * ProStudioMasters 搜索：调用主进程 modules/search.ts
 *
 * 阶段 1 scaffold：ProStudioMasters 是付费 Hi-Res 商店，未注入有效凭据前主进程直接返回空结果，
 * 渲染端保持 Proxy 调用 + Track.source="prostudiomasters" 以便后续凭据接入时无需改动调用层。
 *
 * - track.id 为 ProStudioMasters track id（字符串形式）
 * - 默认 qualities 仅含 "flac_24bit_192k"（PSM 主打 Hi-Res 24bit/192kHz）
 */
export const songs = async (
  keyword: string,
  offset: number,
  limit: number,
): Promise<SearchResult<Track>> => {
  const body = await psmApi.search<SongsResp>({
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
