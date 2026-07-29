/**
 * 歌词（Internet Archive）—— 占位
 *
 * archive.org 不提供歌词数据，etree 集合是现场录音也无同步歌词。
 * 直接返回 404 占位，避免阻塞 search/song_url 链路落地。
 *
 * params:
 * - trackId  archive.org identifier
 */

import { archiveLog } from "@main/utils/logger";
import type { ArchiveModule } from "../core/types";

interface LyricOut {
  code: number;
  message?: string;
}

const lyric: ArchiveModule = async (params) => {
  const { trackId } = params as { trackId?: string };
  archiveLog.info(`[ERR-13006-A] Archive 歌词未实现: trackId=${trackId ?? "-"}`);
  return {
    code: 404,
    message: "archive.org does not provide lyrics",
  } satisfies LyricOut;
};

export default lyric;
