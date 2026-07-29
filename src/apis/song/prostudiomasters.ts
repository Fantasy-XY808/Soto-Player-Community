import type { Track } from "@shared/types/player";
import { prostudiomasters as psmApi } from "@/apis/prostudiomasters";

interface SongUrlResp {
  code: number;
  url: string;
  /** 来源：固定 "psm"（scaffold 阶段为空 URL） */
  source?: "psm";
  message?: string;
}

/**
 * 解析 ProStudioMasters Track 的可播放 URL
 *
 * 阶段 1 scaffold：ProStudioMasters 是付费 Hi-Res 商店，未注入有效凭据前主进程直接返回空 URL。
 * 渲染端调用层保持与 qobuz / archive 一致的结构，凭据接入后无需改动调用方。
 *
 * @param track - track.id 为 ProStudioMasters track id
 * @returns 可播放 URL；当前阶段凭据未接入返回 null
 */
export const resolveProstudiomastersUrl = async (track: Track): Promise<string | null> => {
  try {
    const body = await psmApi.song_url<SongUrlResp>({ trackId: String(track.id) });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
