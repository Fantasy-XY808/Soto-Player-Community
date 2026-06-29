import type { Track } from "@shared/types/player";
import type { CoverItem } from "@/types/artist";
import type { NeteaseSong } from "@/types/netease";
import { netease as neteaseApi } from "@/apis/netease";
import { songsToTracks, toPlaylist, toArtist, withPicSize } from "@/utils/format/netease";
import { playlistToCoverItem, artistToCoverItem } from "@/utils/format/coverItem";

/** 排行榜原始结构 */
interface RawToplist {
  id: number | string;
  name: string;
  description?: string;
  updateFrequency?: string;
  trackCount?: number;
  playCount?: number;
  coverImgUrl?: string;
}

/** 排行榜 → 封面卡片 */
const toplistToCover = (raw: RawToplist): CoverItem => ({
  id: String(raw.id),
  title: raw.name,
  cover: withPicSize(raw.coverImgUrl),
  subtitle: raw.updateFrequency || raw.description || undefined,
  trackCount: raw.trackCount ?? 0,
});

/** 所有官方排行榜列表 */
export const fetchToplists = async (): Promise<CoverItem[]> => {
  const body = await neteaseApi.toplist<{ list?: RawToplist[] }>();
  return (body?.list ?? []).map(toplistToCover);
};

/** 排行榜详情（含完整曲目列表） */
export const fetchToplistDetail = async (id: string): Promise<{ tracks: Track[] }> => {
  const body = await neteaseApi.toplist_detail<{ playlist?: { tracks?: NeteaseSong[] } }>({ id });
  return { tracks: songsToTracks(body?.playlist?.tracks ?? []) };
};

/** 新歌速递地区 id */
export type NewSongArea = 0 | 7 | 96 | 8 | 16;

/** 新歌速递原始结构 */
interface RawNewSong {
  id: number | string;
  name: string;
  song: NeteaseSong;
}

/** 新歌速递 */
export const fetchNewSongs = async (areaId: NewSongArea = 0, limit = 50): Promise<Track[]> => {
  const body = await neteaseApi.top_song<{ data?: RawNewSong[] }>({ areaId, limit });
  return songsToTracks((body?.data ?? []).map((item) => item.song));
};

/** 相似歌曲 */
export const fetchSimiSongs = async (songId: string, limit = 50): Promise<Track[]> => {
  const body = await neteaseApi.simi_song<{ songs?: NeteaseSong[] }>({ songid: songId, limit });
  return songsToTracks(body?.songs ?? []);
};

/** 相似歌手 */
export const fetchSimiArtists = async (artistId: string): Promise<CoverItem[]> => {
  const body = await neteaseApi.simi_artist<{ artists?: unknown[] }>({ artistid: artistId });
  return (body?.artists ?? []).map((raw) => artistToCoverItem(toArtist(raw)));
};

/** 相似歌单 */
export const fetchSimiPlaylists = async (playlistId: string, limit = 30): Promise<CoverItem[]> => {
  const body = await neteaseApi.simi_playlist<{ playlists?: unknown[] }>({
    playlistid: playlistId,
    limit,
  });
  return (body?.playlists ?? []).map((raw) => playlistToCoverItem(toPlaylist(raw)));
};
