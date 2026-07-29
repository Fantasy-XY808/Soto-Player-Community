/**
 * 歌词（2L）—— 占位
 *
 * 2L 是挪威 Hi-Res 厂牌，仅提供试听音频文件，不提供歌词数据。
 * 直接返回 404 占位，避免阻塞 search/song_url 链路落地。
 *
 * params:
 * - trackId  2L 试听曲目 id
 */

import { twoLLog } from "@main/utils/logger";
import type { TwoLModule } from "../core/types";

interface LyricOut {
  code: number;
  message?: string;
}

const lyric: TwoLModule = async (params) => {
  const { trackId } = params as { trackId?: string };
  twoLLog.info(`[ERR-14XXX-E] 2L 歌词未实现: trackId=${trackId ?? "-"}`);
  return {
    code: 404,
    message: "2L does not provide lyrics",
  } satisfies LyricOut;
};

export default lyric;
