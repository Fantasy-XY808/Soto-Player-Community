/**
 * 歌词（mora）—— 占位
 *
 * mora 是日本索尼 Hi-Res 商店，主要提供 Hi-Res 母带音源，不提供歌词数据。
 * 直接返回 404 占位，避免阻塞 search/song_url 链路落地。
 *
 * params:
 * - trackId  mora track id
 */

import { moraLog } from "@main/utils/logger";
import type { MoraModule } from "../core/types";

interface LyricOut {
  code: number;
  message?: string;
}

const lyric: MoraModule = async (params) => {
  const { trackId } = (params ?? {}) as { trackId?: unknown };
  moraLog.info(`[ERR-14103-A] mora 歌词未实现: trackId=${String(trackId ?? "-")}`);
  return {
    code: 404,
    message: "mora does not provide lyrics",
  } satisfies LyricOut;
};

export default lyric;
