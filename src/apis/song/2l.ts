import type { Track } from "@shared/types/player";
import { twoL as twoLApi } from "@/apis/2l";

interface SongUrlResp {
  code: number;
  url: string;
  /** 来源：固定 "2l"（2L 免费样品直链，无签名无时效） */
  source?: "2l";
  message?: string;
}

/**
 * 解析 2L Track 的可播放 URL
 *
 * 2L 是免费样品，search 已把直链放进 track.hashes["2l-url"]，
 * 主进程 song_url 模块直接透传返回（无签名、无时效）。
 *
 * 2L 仅个人试听模式，禁止曲库收录：
 * 返回的 URL 仅用于流式试听，不可下载落盘或加入用户曲库。
 *
 * @param track - track.id 为 2L 试听曲目 id，track.hashes["2l-url"] 为直链
 * @returns 可播放 URL；hashes 缺失或主进程返回空时返回 null
 */
export const resolve2LUrl = async (track: Track): Promise<string | null> => {
  try {
    const body = await twoLApi.song_url<SongUrlResp>({
      trackId: String(track.id),
      // 透传 search 抓取的直链 hash 字典，主进程按 "2l-url" key 取直链
      hashes: track.hashes,
      // 兜底：若 hashes 缺失，直接传 url 让主进程原样返回
      url: track.hashes?.["2l-url"],
    });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
