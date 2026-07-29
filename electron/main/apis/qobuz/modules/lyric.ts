/**
 * 歌词（Qobuz）—— 阶段 1 占位
 *
 * Qobuz 不直接提供时间轴歌词，公开端点只有：
 *   /album/get?album_id={id}  →  album.description（部分专辑有法/英文 album review，非逐行 LRC）
 *   /track/get?track_id={id}  →  track.lyrics（部分曲目有纯文本同步歌词，字段存在性不稳定）
 *
 * 真实可用方案需另起调研：karaoke-eq / LRCLIB / Musixmatch 等第三方库交叉匹配 ISRC。
 * 本模块先按"占位返回未实现"占位，避免阻塞 search/song_url 链路落地。
 *
 * params:
 * - trackId   Qobuz track id
 * - albumId   Qobuz album id（可选，未来用于回查 album.description）
 * - isrc      ISRC（可选，未来用于 LRCLIB 匹配）
 */

import { QOBUZ_API_BASE } from "../core/config";
import { qobuzRequest } from "../core/request";
import { qobuzLog } from "@main/utils/logger";
import type { QobuzModule } from "../core/types";

interface QobuzTrackGetResp {
  track?: {
    id?: number;
    /** 部分曲目会带纯文本同步歌词（含 [mm:ss] 头），存在性不稳定 */
    lyrics?: string;
  };
}

interface LyricOut {
  code: number;
  lrc?: string;
  trans?: string;
  roma?: string;
  message?: string;
}

const lyric: QobuzModule = async (params) => {
  const { trackId, albumId, isrc } = params as {
    trackId?: string;
    albumId?: string;
    isrc?: string;
  };

  if (!trackId) return { code: 400, message: "trackId required" } satisfies LyricOut;

  // 阶段 1：尝试 /track/get 拿 track.lyrics（存在性不稳定）
  try {
    const url = `${QOBUZ_API_BASE}/track/get?track_id=${encodeURIComponent(trackId)}`;
    const body = await qobuzRequest<QobuzTrackGetResp>(url);
    const lrc = body.track?.lyrics?.trim();
    if (lrc) {
      qobuzLog.info(`[ERR-11012-A] Qobuz 原生歌词命中: trackId=${trackId} len=${lrc.length}`);
      return { code: 200, lrc } satisfies LyricOut;
    }
  } catch (err) {
    qobuzLog.warn(`[ERR-11013-A] Qobuz 原生歌词拉取失败: trackId=${trackId}`, err);
  }

  // 占位：第三方歌词源（LRCLIB / Musixmatch via ISRC）待后续 impl1e+ 接入
  qobuzLog.info(
    `[ERR-11014-A] Qobuz 歌词未命中，待第三方源接入: trackId=${trackId} albumId=${albumId ?? "-"} isrc=${isrc ?? "-"}`,
  );
  return {
    code: 404,
    message: "qobuz native lyrics unavailable; third-party (LRCLIB/Musixmatch) pending",
  } satisfies LyricOut;
};

export default lyric;
