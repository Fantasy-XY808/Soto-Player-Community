/**
 * 歌词（Tidal）—— 占位
 *
 * Tidal 公开 API 不直接提供时间轴歌词，只有部分曲目通过 /tracks/{id}/lyrics 拿纯文本同步歌词，
 * 但该端点对 OAuth scope 要求较严，且字段存在性不稳定。
 *
 * 真实可用方案需另起调研：LRCLIB / Musixmatch 等第三方库交叉匹配 ISRC。
 * 本模块先按"占位返回未实现"占位，避免阻塞 search/song_url 链路落地。
 *
 * params:
 * - trackId   Tidal track id
 * - isrc      ISRC（可选，未来用于 LRCLIB 匹配）
 */

import { tidalLog } from "@main/utils/logger";
import type { TidalModule } from "../core/types";

interface LyricOut {
  code: number;
  lrc?: string;
  trans?: string;
  roma?: string;
  message?: string;
}

const lyric: TidalModule = async (params) => {
  const { trackId, isrc } = params as {
    trackId?: string;
    isrc?: string;
  };

  if (!trackId) return { code: 400, message: "trackId required" } satisfies LyricOut;

  tidalLog.info(
    `[ERR-12006-A] Tidal 歌词未命中，待第三方源接入: trackId=${trackId} isrc=${isrc ?? "-"}`,
  );
  return {
    code: 404,
    message: "tidal does not provide lyrics; third-party (LRCLIB/Musixmatch) pending",
  } satisfies LyricOut;
};

export default lyric;
