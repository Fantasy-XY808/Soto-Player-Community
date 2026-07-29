/**
 * Spotify 搜索实现
 *
 * 调用 Spotify Web API /v1/search 搜索单曲 / 专辑 / 歌手 / 歌单
 *
 * 端点：GET /v1/search?q={keywords}&type={type}&limit={limit}&offset={offset}
 * 鉴权：应用级 access_token（Client Credentials Flow）
 *
 * 响应字段参见：https://developer.spotify.com/documentation/web-api/reference/search
 *
 * params:
 * - keywords  关键词（必填）
 * - type      资源类型，默认 "track"（track / album / artist / playlist）
 * - offset    偏移量，默认 0
 * - limit     每页数量，默认 20
 */

import { SPOTIFY_API_BASE } from "./core/config";
import { getAppAccessToken } from "./auth";
import { spotifyLog } from "@main/utils/logger";
import type { SpotifyModule } from "./core/types";

interface SpotifyImage {
  url: string;
  height?: number;
  width?: number;
}

interface SpotifyTrackItem {
  id: string;
  name: string;
  duration_ms: number;
  artists: Array<{ name: string }>;
  album: {
    name: string;
    images: SpotifyImage[];
  };
}

interface SpotifyAlbumItem {
  id: string;
  name: string;
  images: SpotifyImage[];
  artists: Array<{ name: string }>;
  total_tracks: number;
}

interface SpotifyArtistItem {
  id: string;
  name: string;
  images?: SpotifyImage[];
}

interface SpotifyPlaylistItem {
  id: string;
  name: string;
  images?: SpotifyImage[];
  owner?: { display_name?: string };
  tracks?: { total: number };
}

interface SpotifySearchResponse {
  tracks?: { items: SpotifyTrackItem[]; total: number };
  albums?: { items: SpotifyAlbumItem[]; total: number };
  artists?: { items: SpotifyArtistItem[]; total: number };
  playlists?: { items: SpotifyPlaylistItem[]; total: number };
}

/** 根据 type 推导结果字段名 */
const resultKey = (type: string): "tracks" | "albums" | "artists" | "playlists" => {
  if (type === "album") return "albums";
  if (type === "artist") return "artists";
  if (type === "playlist") return "playlists";
  return "tracks";
};

const search: SpotifyModule = async (params) => {
  const {
    keywords,
    type = "track",
    offset = 0,
    limit = 20,
  } = params as {
    keywords?: string;
    type?: string;
    offset?: number;
    limit?: number;
  };

  const key = resultKey(type);

  if (!keywords) {
    return { code: 400, total: 0, [key]: [] };
  }

  const token = await getAppAccessToken();
  if (!token) {
    // 未配置凭证时返回 401，让上层回落其他音源
    return { code: 401, total: 0, [key]: [] };
  }

  const url =
    `${SPOTIFY_API_BASE}/search?q=${encodeURIComponent(keywords)}` +
    `&type=${type}&limit=${limit}&offset=${offset}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const text = await res.text();
      spotifyLog.warn(`[spotify] search failed: ${res.status} ${text}`);
      return { code: res.status, total: 0, [key]: [] };
    }

    const data = (await res.json()) as SpotifySearchResponse;

    if (type === "track") {
      const tracks = data.tracks?.items ?? [];
      return {
        code: 200,
        total: data.tracks?.total ?? tracks.length,
        tracks: tracks.map((t) => ({
          id: t.id,
          name: t.name,
          duration_ms: t.duration_ms,
          artists: t.artists,
          album: { name: t.album.name, images: t.album.images },
        })),
      };
    }

    if (type === "album") {
      const albums = data.albums?.items ?? [];
      return {
        code: 200,
        total: data.albums?.total ?? albums.length,
        albums: albums.map((a) => ({
          id: a.id,
          name: a.name,
          images: a.images,
          artists: a.artists,
          total_tracks: a.total_tracks,
        })),
      };
    }

    if (type === "artist") {
      const artists = data.artists?.items ?? [];
      return {
        code: 200,
        total: data.artists?.total ?? artists.length,
        artists: artists.map((a) => ({
          id: a.id,
          name: a.name,
          images: a.images,
        })),
      };
    }

    if (type === "playlist") {
      const playlists = data.playlists?.items ?? [];
      return {
        code: 200,
        total: data.playlists?.total ?? playlists.length,
        playlists: playlists.map((p) => ({
          id: p.id,
          name: p.name,
          images: p.images,
          owner: p.owner,
          tracks: p.tracks,
        })),
      };
    }

    return { code: 400, total: 0 };
  } catch (err) {
    spotifyLog.warn("[spotify] search error:", err);
    return { code: 500, total: 0 };
  }
};

export default search;
