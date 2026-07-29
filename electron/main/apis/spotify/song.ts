/**
 * Spotify 曲目详情 / 收藏状态
 *
 * 端点：
 * - GET /v1/tracks?ids={id1,id2,...}        批量取曲目元数据（应用级 token）
 * - GET /v1/me/tracks/contains?ids={ids}    批量判断是否已收藏到用户曲库（用户级 token）
 *
 * Spotify 官方 API 不直接提供可播放的 MP3 URL；
 * 上层播放逻辑应通过插件或外部方案（如 spotify-dl）解析实际音源。
 *
 * params:
 * - trackIds  曲目 id 数组（必填，最多 50 个）
 * - check     是否同时查询收藏状态，默认 false
 */

import { SPOTIFY_API_BASE } from "./core/config";
import { getAppAccessToken, getUserAccessToken } from "./auth";
import { spotifyLog } from "@main/utils/logger";
import type { SpotifyModule } from "./core/types";

interface SpotifyTrackDetail {
  id: string;
  name: string;
  duration_ms: number;
  preview_url: string | null;
  artists: Array<{ id?: string; name: string }>;
  album: {
    id?: string;
    name: string;
    images: Array<{ url: string; height?: number; width?: number }>;
  };
}

interface SpotifyTracksResponse {
  tracks: SpotifyTrackDetail[];
}

const song: SpotifyModule = async (params) => {
  const { trackIds, check = false } = params as {
    trackIds?: string | string[];
    check?: boolean;
  };

  // 入参兼容字符串（单个 id）与字符串数组
  const ids = Array.isArray(trackIds)
    ? trackIds.map((s) => String(s).trim()).filter(Boolean)
    : String(trackIds ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

  if (ids.length === 0) {
    return { code: 400, message: "trackIds required" };
  }

  // Spotify /v1/tracks 单次最多 50 个
  const capped = ids.slice(0, 50);

  try {
    // 1. 取曲目详情（应用级 token 即可）
    const appToken = await getAppAccessToken();
    if (!appToken) {
      return { code: 401, message: "spotify app token unavailable" };
    }

    const tracksUrl = `${SPOTIFY_API_BASE}/tracks?ids=${encodeURIComponent(capped.join(","))}`;
    const tracksRes = await fetch(tracksUrl, {
      headers: { Authorization: `Bearer ${appToken}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!tracksRes.ok) {
      const text = await tracksRes.text();
      spotifyLog.warn(`[spotify] /v1/tracks failed: ${tracksRes.status} ${text}`);
      return { code: tracksRes.status, message: text };
    }

    const tracksData = (await tracksRes.json()) as SpotifyTracksResponse;
    const tracks = tracksData.tracks ?? [];

    // 2. 可选：查询收藏状态（需用户级 token）
    let contains: boolean[] | undefined;
    if (check) {
      const userToken = await getUserAccessToken();
      if (!userToken) {
        spotifyLog.warn("[spotify] 用户未登录，跳过 contains 查询");
      } else {
        const containsUrl = `${SPOTIFY_API_BASE}/me/tracks/contains?ids=${encodeURIComponent(
          capped.join(","),
        )}`;
        const containsRes = await fetch(containsUrl, {
          headers: { Authorization: `Bearer ${userToken}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!containsRes.ok) {
          spotifyLog.warn(`[spotify] /v1/me/tracks/contains failed: ${containsRes.status}`);
        } else {
          contains = (await containsRes.json()) as boolean[];
        }
      }
    }

    return {
      code: 200,
      tracks: tracks.map((t) => ({
        id: t.id,
        name: t.name,
        duration_ms: t.duration_ms,
        preview_url: t.preview_url,
        artists: t.artists,
        album: t.album,
      })),
      contains,
      // Spotify 不直接提供可播放 URL，由插件或外部方案接管
      url: null,
    };
  } catch (err) {
    spotifyLog.warn("[spotify] song detail error:", err);
    return { code: 500, message: err instanceof Error ? err.message : String(err) };
  }
};

export default song;
