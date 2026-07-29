/**
 * 歌词（ProStudioMasters）—— 占位
 *
 * ProStudioMasters 是专业 Hi-Res 母带商店，主要提供 Hi-Res 母带音源，不提供歌词数据。
 * 直接返回 404 占位，避免阻塞 search/song_url 链路落地。
 *
 * params:
 * - trackId  ProStudioMasters track id
 */

import { psmLog } from "@main/utils/logger";
import type { PsmModule } from "../core/types";

interface LyricOut {
  code: number;
  message?: string;
}

const lyric: PsmModule = async (params) => {
  const { trackId } = params as { trackId?: string };
  psmLog.info(`[ERR-14XXX-B] ProStudioMasters 歌词未实现: trackId=${trackId ?? "-"}`);
  return {
    code: 404,
    message: "prostudiomasters does not provide lyrics",
  } satisfies LyricOut;
};

export default lyric;
