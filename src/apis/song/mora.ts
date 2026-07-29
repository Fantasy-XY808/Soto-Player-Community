import type { Track } from "@shared/types/player";
import { mora as moraApi } from "@/apis/mora";

interface SongUrlResp {
  code: number;
  url: string;
  /** 来源：固定 "mora"（scaffold 阶段为空 URL） */
  source?: "mora";
  message?: string;
}

/**
 * 解析 mora Track 的可播放 URL
 *
 * 试听路径免登录：从搜索结果透传的 hashes["mora-preview"] 取 AAC 试听直链。
 * 主进程 song_url 模块按优先级 hashes["mora-preview"] → previewUrl 取直链返回。
 *
 * @param track - track.id 为 mora track id；track.hashes["mora-preview"] 为 AAC 试听直链
 * @returns 可播放 URL；未拿到试听直链返回 null
 */
export const resolveMoraUrl = async (track: Track): Promise<string | null> => {
  try {
    const hashes = track.hashes ?? {};
    const previewUrl = hashes["mora-preview"] ?? "";
    const body = await moraApi.song_url<SongUrlResp>({
      trackId: String(track.id),
      hashes,
      previewUrl,
    });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
