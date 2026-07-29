/**
 * 搜索歌曲（Tidal）
 *
 * 端点：GET /search?query={kw}&type=TRACKS&limit={limit}&offset={offset}
 * 需 Authorization: Bearer ${access_token}（核心 request 层自动注入）
 *
 * 返回结构沿用 qobuz.search：duration 为毫秒，带 Tidal 特有的音质元数据
 * （audioModes: HIRES_LOSSLESS / MQA / LOSSLESS / HIGH）
 *
 * params:
 * - keywords  关键词（必填）
 * - page      页码，默认 1
 * - limit     每页数，默认 30
 */

import { TIDAL_API_BASE, decodeName, tidalCoverUrl } from "../core/config";
import { tidalRequest } from "../core/request";
import { tidalLog } from "@main/utils/logger";
import type { TidalModule } from "../core/types";

interface TidalArtistRaw {
  id?: number;
  name?: string;
  type?: string;
}

interface TidalAlbumRaw {
  id?: number;
  title?: string;
  cover?: string;
}

interface TidalTrackRaw {
  id: number;
  title?: string;
  duration?: number;
  /** 是否可流播放（需订阅） */
  streamable?: boolean;
  /** 音频模式列表：HIRES_LOSSLESS / MQA / LOSSLESS / HIGH */
  audioModes?: string[];
  artists?: TidalArtistRaw[];
  album?: TidalAlbumRaw;
}

interface TidalSearchResp {
  tracks?: {
    items?: TidalTrackRaw[];
    totalNumberOfItems?: number;
  };
}

interface NormalizedSong {
  /** Tidal track id（数字字符串） */
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  cover?: string;
  /** 毫秒 */
  duration: number;
  streamable: boolean;
  /** 最高可用位深（16 / 24），根据 audioModes 推断 */
  maximumBitDepth?: number;
  /** 最高可用采样率（44.1 / 96 / 192），根据 audioModes 推断 */
  maximumSamplingRate?: number;
  hirez: boolean;
  qualities: string[];
}

/**
 * 根据 audioModes 派生可用音质档位
 *
 * - HIRES_LOSSLESS: 16bit/44.1kHz FLAC（HiFi 订阅）
 * - MQA: 24bit/96kHz/192kHz MQA-FLAC（HiFi+ 订阅）
 * - LOSSLESS: 16bit/44.1kHz FLAC（与 HIRES_LOSSLESS 等价）
 * - HIGH: 320kbps AAC/MP3
 */
const deriveQualities = (audioModes: string[] | undefined): {
  qualities: string[];
  maxBitDepth: number;
  maxSamplingRate: number;
  hirez: boolean;
} => {
  const modes = (audioModes ?? []).map((m) => m.toUpperCase());
  const qualities: string[] = [];
  let maxBitDepth = 0;
  let maxSamplingRate = 0;
  let hirez = false;

  if (modes.length > 0) {
    qualities.push("mp3_320");
  }
  if (modes.includes("HIRES_LOSSLESS") || modes.includes("LOSSLESS")) {
    qualities.push("flac_16bit");
    maxBitDepth = Math.max(maxBitDepth, 16);
    maxSamplingRate = Math.max(maxSamplingRate, 44.1);
  }
  if (modes.includes("MQA")) {
    qualities.push("flac_24bit_96k");
    maxBitDepth = Math.max(maxBitDepth, 24);
    maxSamplingRate = Math.max(maxSamplingRate, 96);
    hirez = true;
  }

  return { qualities, maxBitDepth, maxSamplingRate, hirez };
};

const normalizeTrack = (raw: TidalTrackRaw): NormalizedSong => {
  const { qualities, maxBitDepth, maxSamplingRate, hirez } = deriveQualities(raw.audioModes);
  return {
    id: String(raw.id),
    title: decodeName(raw.title ?? ""),
    artist: (raw.artists ?? []).map((a) => decodeName(a.name ?? "")).filter(Boolean).join(", "),
    album: decodeName(raw.album?.title ?? ""),
    albumId: raw.album?.id != null ? String(raw.album.id) : "",
    cover: tidalCoverUrl(raw.album?.cover),
    duration: (raw.duration ?? 0) * 1000,
    streamable: raw.streamable === true,
    maximumBitDepth: maxBitDepth || undefined,
    maximumSamplingRate: maxSamplingRate || undefined,
    hirez,
    qualities,
  };
};

const search: TidalModule = async (params) => {
  const { keywords, page = 1, limit = 30 } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
  };

  if (!keywords) {
    return { code: 400, total: 0, songs: [], message: "keywords required" };
  }

  const offset = (page - 1) * limit;
  const url =
    `${TIDAL_API_BASE}/search` +
    `?query=${encodeURIComponent(keywords)}` +
    `&type=TRACKS&limit=${limit}&offset=${offset}`;

  try {
    const body = await tidalRequest<TidalSearchResp>(url);
    const items = body.tracks?.items ?? [];
    const songs = items.map(normalizeTrack);
    const total = body.tracks?.totalNumberOfItems ?? songs.length;
    tidalLog.info(
      `[ERR-12001-A] Tidal 搜索成功: keywords="${keywords}" page=${page} hits=${songs.length}/${total}`,
    );
    return { code: 200, total, songs };
  } catch (err) {
    tidalLog.warn(`[ERR-12002-A] Tidal 搜索失败: keywords="${keywords}"`, err);
    return { code: 200, total: 0, songs: [] };
  }
};

export default search;
