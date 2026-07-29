/**
 * 歌词（Bilibili）—— 占位
 *
 * B站是视频平台，无歌词数据。直接返回 404 占位，避免阻塞 search/song_url 链路落地。
 *
 * params:
 * - trackId  视频 BV 号
 */

import { bilibiliLog } from "@main/utils/logger";
import type { BiliModule } from "../core/types";

interface LyricOut {
  code: number;
  message?: string;
}

const lyric: BiliModule = async (params) => {
  const { trackId } = params as { trackId?: string };
  bilibiliLog.info(`[BILI-LYRIC] 歌词未实现: trackId=${trackId ?? "-"}`);
  return {
    code: 404,
    message: "bilibili does not provide lyrics",
  } satisfies LyricOut;
};

export default lyric;
