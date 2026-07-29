import type { Track } from "@shared/types/player";
import { tidal as tidalApi } from "@/apis/tidal";

interface SongUrlResp {
  code: number;
  url: string;
  /** 来源：stream（订阅真 Hi-Res）/ none */
  source?: "stream" | "none";
  bitDepth?: number;
  samplingRate?: number;
  message?: string;
}

/**
 * 解析 Tidal Track 的可播放 URL
 *
 * 主进程 song_url 模块流程：
 * - 调 /tracks/{id}/playbackinfopostpaywall 拿 manifest（base64 编码 JSON）
 * - 解码 manifest 取 url 字段（CDN 直链，有时效）
 * - 401 时自动刷新 token 重试一次
 *
 * HiFi 订阅 → 16bit/44.1kHz FLAC；HiFi+ 订阅 → 24bit/96kHz/192kHz MQA-FLAC
 *
 * @param track - track.id 为 Tidal track id（数字字符串）
 * @returns 可播放 URL；完全无可用源返回 null
 */
export const resolveTidalUrl = async (track: Track): Promise<string | null> => {
  try {
    const body = await tidalApi.song_url<SongUrlResp>({ trackId: String(track.id) });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
