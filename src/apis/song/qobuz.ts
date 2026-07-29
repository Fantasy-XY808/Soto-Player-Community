import type { Track } from "@shared/types/player";
import { qobuz as qobuzApi } from "@/apis/qobuz";

interface SongUrlResp {
  code: number;
  url: string;
  /** 来源：stream（订阅真 Hi-Res）/ preview（30s 试听）/ none */
  source?: "stream" | "preview" | "none";
  /** 是否为 30s 试听 */
  preview?: boolean;
  formatId?: number;
  bitDepth?: number;
  samplingRate?: number;
  message?: string;
}

/**
 * 解析 Qobuz Track 的可播放 URL
 *
 * 双阶段策略（与主进程 modules/song_url.ts 对齐）：
 * - 登录态 + 付费订阅：调 /track/getFileUrl 用 MD5 签名拿真 Hi-Res FLAC（24bit/192kHz）
 * - 未登录 / free 账号：调 /track/get 拿 30s preview（公开 MP3）
 *
 * app_secret 周期性被 Qobuz 黑名单时，主进程会自动切换到下一个候选 secret 重试。
 *
 * @param track - track.id 为 Qobuz track id（数字字符串）
 * @returns 可播放 URL；30s 试听也返回；完全无可用源返回 null
 */
export const resolveQobuzUrl = async (track: Track): Promise<string | null> => {
  try {
    const body = await qobuzApi.song_url<SongUrlResp>({ trackId: String(track.id) });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
