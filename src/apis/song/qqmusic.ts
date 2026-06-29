import type { Track } from "@shared/types/player";
import { qqmusic as qqmusicApi } from "@/apis/qqmusic";

interface SongUrlResp {
  code: number;
  url: string;
  message?: string;
}

/**
 * 解析 QQ 音乐 Track 的可播放 URL
 * 匿名态只能拿 128k mp3；VIP / 版权 → 返回 null，由调用方回落插件
 * @param track - track.id 为 songmid
 */
export const resolveQQMusicUrl = async (track: Track): Promise<string | null> => {
  try {
    const body = await qqmusicApi.song_url<SongUrlResp>({ mid: track.id });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
