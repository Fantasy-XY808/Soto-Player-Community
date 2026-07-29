/**
 * 搜索歌曲（Qobuz）
 *
 * 端点：GET /track/search?query={query}&limit={limit}&offset={offset}
 * 公开 API，仅需 X-App-Id header（无鉴权）
 *
 * 返回结构沿用 kugou.search：duration 为毫秒，并带 Qobuz 特有的音质元数据
 * （maximum_bit_depth / maximum_sampling_rate / hirez_streamable）
 *
 * params:
 * - keywords  关键词（必填）
 * - page      页码，默认 1
 * - limit     每页数，默认 30
 */

import { QOBUZ_API_BASE, decodeName } from "../core/config";
import { qobuzRequest } from "../core/request";
import { qobuzLog } from "@main/utils/logger";
import type { QobuzModule } from "../core/types";

interface QobuzTrackRaw {
  id: number;
  title?: string;
  version?: string;
  performer?: { id: number; name: string };
  album?: {
    id: number;
    title?: string;
    image?: {
      small?: string;
      thumbnail?: string;
      large?: string;
    };
  };
  duration?: number;
  /** 是否可完整流播放（需订阅） */
  streamable?: boolean;
  /** 是否可试听（30s preview） */
  previewable?: boolean;
  /** 试听 URL（公开，64kbps MP3，约 30s） */
  preview_url?: string;
  /** 最高可用位深（如 16 / 24） */
  maximum_bit_depth?: number;
  /** 最高可用采样率（如 44.1 / 96 / 192） */
  maximum_sampling_rate?: number;
  /** 是否支持 Hi-Res 流 */
  hirez_streamable?: boolean;
  /** 是否支持 Hi-Res 24bit 流 */
  hirez?: boolean;
  /** 文件大小（字节，最大格式） */
  file_size?: number;
  /** PCM 比特率（kbps，最大格式） */
  maximum_bitrate?: number;
  /** 表演者列表（部分版本字段名不同） */
  performers?: string;
}

interface QobuzSearchResp {
  tracks?: {
    items?: QobuzTrackRaw[];
    total?: number;
  };
}

interface NormalizedSong {
  /** Qobuz track id（数字字符串） */
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  cover?: string;
  coverOriginal?: string;
  /** 毫秒 */
  duration: number;
  streamable: boolean;
  previewable: boolean;
  /** 试听 URL（公开 MP3，约 30s） */
  previewUrl?: string;
  /** 最高可用位深（16 / 24） */
  maximumBitDepth?: number;
  /** 最高可用采样率（44.1 / 96 / 192） */
  maximumSamplingRate?: number;
  hirez: boolean;
  qualities: string[];
}

const normalizeTrack = (raw: QobuzTrackRaw): NormalizedSong => {
  const qualities: string[] = [];
  const maxBd = raw.maximum_bit_depth ?? 0;
  const maxSr = raw.maximum_sampling_rate ?? 0;
  if (raw.streamable) {
    qualities.push("mp3_320");
    if (maxBd >= 16) qualities.push("flac_16bit");
    if (maxBd >= 24 && maxSr >= 96) qualities.push("flac_24bit_96k");
    if (maxBd >= 24 && maxSr >= 192) qualities.push("flac_24bit_192k");
  }

  return {
    id: String(raw.id),
    title: decodeName(raw.title ?? ""),
    artist: decodeName(raw.performer?.name ?? raw.performers ?? ""),
    album: decodeName(raw.album?.title ?? ""),
    albumId: raw.album?.id != null ? String(raw.album.id) : "",
    cover: raw.album?.image?.thumbnail ?? raw.album?.image?.small,
    coverOriginal: raw.album?.image?.large,
    duration: (raw.duration ?? 0) * 1000,
    streamable: raw.streamable === true,
    previewable: raw.previewable === true,
    previewUrl: raw.preview_url,
    maximumBitDepth: maxBd || undefined,
    maximumSamplingRate: maxSr || undefined,
    hirez: raw.hirez_streamable === true || raw.hirez === true,
    qualities,
  };
};

const search: QobuzModule = async (params) => {
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
    `${QOBUZ_API_BASE}/track/search` +
    `?query=${encodeURIComponent(keywords)}` +
    `&limit=${limit}&offset=${offset}`;

  try {
    const body = await qobuzRequest<QobuzSearchResp>(url);
    const items = body.tracks?.items ?? [];
    const songs = items.map(normalizeTrack);
    const total = body.tracks?.total ?? songs.length;
    qobuzLog.info(
      `[ERR-11001-A] Qobuz 搜索成功: keywords="${keywords}" page=${page} hits=${songs.length}/${total}`,
    );
    return { code: 200, total, songs };
  } catch (err) {
    qobuzLog.warn(`[ERR-11002-A] Qobuz 搜索失败: keywords="${keywords}"`, err);
    return { code: 200, total: 0, songs: [] };
  }
};

export default search;
