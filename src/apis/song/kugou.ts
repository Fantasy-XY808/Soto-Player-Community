import type { Track } from "@shared/types/player";
import { kugou as kugouApi } from "@/apis/kugou";

interface SongUrlResp {
  code: number;
  url: string;
  message?: string;
}

/**
 * 解析酷狗 Track 的可播放 URL
 * 匿名态只能拿 128k mp3；VIP / 版权 → 返回 null，由调用方回落插件
 * @param track - track.id 为 hash，track.album.id 为 album_id
 */
export const resolveKugouUrl = async (track: Track): Promise<string | null> => {
  try {
    const body = await kugouApi.song_url<SongUrlResp>({
      hash: track.id,
      albumId: track.album?.id,
    });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
