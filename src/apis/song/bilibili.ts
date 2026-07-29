import type { Track } from "@shared/types/player";
import { bilibili as bilibiliApi } from "@/apis/bilibili";

interface SongUrlResp {
  code: number;
  url: string;
  /** 来源：固定 "bilibili" */
  source?: "bilibili";
  message?: string;
}

/**
 * 解析 Bilibili Track 的可播放 URL
 *
 * 流程（与主进程 modules/song_url.ts 对齐）：
 * - 调 /x/web-interface/view?bvid={bvid} 取 cid
 * - 调 /x/player/playurl?bvid={bvid}&cid={cid}&fnval=16 取 DASH 音频流
 * - audio[] 按 id 优先级排序：30251 (Hi-Res) > 30280 (192k) > 30232 (128k) > 30216 (64k)
 * - 返回最优音频流的 baseUrl
 *
 * @param track - track.id 为视频 BV 号
 * @returns 可播放 URL；完全无可用音频流返回 null
 */
export const resolveBilibiliUrl = async (track: Track): Promise<string | null> => {
  try {
    const body = await bilibiliApi.song_url<SongUrlResp>({ trackId: String(track.id) });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
