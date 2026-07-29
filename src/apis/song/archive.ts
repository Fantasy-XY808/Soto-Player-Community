import type { Track } from "@shared/types/player";
import type { QualityLevel } from "@/utils/quality";
import { archive as archiveApi } from "@/apis/archive";

interface SongUrlResp {
  code: number;
  url: string;
  /** 来源：固定 "archive" */
  source?: "archive";
  message?: string;
}

/**
 * 解析 Internet Archive Track 的可播放 URL
 *
 * 流程（与主进程 modules/song_url.ts 对齐）：
 * - 调 /metadata/{identifier} 拿到完整 files 数组
 * - 按音质档位选优先级：
 *   - 高音质（lossless/hi-res/jymaster/sky/jyeffect）：优先 flac → ogg → mp3
 *   - 常规档位（hq/sq/lq）：优先 mp3 → flac → ogg
 * - 拼装下载 URL：https://archive.org/download/{identifier}/{filename}
 *
 * @param track - track.id 为 archive.org identifier
 * @param songLevel - 用户音质档位；高音质优先 flac，常规优先 mp3
 * @returns 可播放 URL；完全无可用音频文件返回 null
 */
export const resolveArchiveUrl = async (
  track: Track,
  songLevel?: QualityLevel,
): Promise<string | null> => {
  try {
    const body = await archiveApi.song_url<SongUrlResp>({
      trackId: String(track.id),
      quality: songLevel,
    });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
