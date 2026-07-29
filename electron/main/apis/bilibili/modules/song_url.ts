/**
 * 获取 Bilibili 播放 URL（DASH 音频流）
 *
 * 流程：
 * 1. GET /x/web-interface/view?bvid={bvid} → data.cid（取首个分P的 cid）
 * 2. GET /x/player/playurl?bvid={bvid}&cid={cid}&fnval=16&fnver=0 → data.dash.audio[]
 *    - fnval=16 表示请求 DASH 格式（含独立音轨流）
 * 3. audio[] 按 id 优先级排序（实地验证 + B站官方 opus 文章）：
 *    - 30251 (Hi-Res 192kHz/24bit FLAC) ← 需大会员 + 视频本身有 Hi-Res 音频
 *    - 30250 (Dolby Audio 杜比音频)       ← 需大会员 + 视频含杜比音轨
 *    - 30280 (192k AAC)
 *    - 30232 (132k AAC)
 *    - 30216 (64k AAC)
 * 4. 返回最优音频流的 baseUrl
 *
 * 失败返回 { code: 200, url: "" }（与 archive 一致，让上层回落其他音源）
 *
 * params:
 * - trackId  视频 BV 号（必填，如 "BV1xx411c7mD"）
 */

import { BILI_API_BASE } from "../core/config";
import { biliRequest } from "../core/request";
import { bilibiliLog } from "@main/utils/logger";
import type { BiliModule } from "../core/types";

interface BiliViewResp {
  code?: number;
  message?: string;
  data?: {
    cid?: number;
    pages?: Array<{ cid?: number }>;
  };
}

interface BiliDashAudio {
  id?: number;
  baseUrl?: string;
  base_url?: string;
  backupUrl?: string[];
  backup_url?: string[];
}

interface BiliPlayurlResp {
  code?: number;
  message?: string;
  data?: {
    dash?: {
      audio?: BiliDashAudio[];
    };
  };
}

/** 音频流 id 优先级：值越小越优先
 *
 * 实地验证（基于 B站官方 opus 文章 + 抓包）：
 * - 30250  Dolby Audio（杜比音频，需大会员 + 视频含杜比音轨）
 * - 30251  Hi-Res 192kHz/24bit FLAC（需大会员 + 视频含 Hi-Res）
 * - 30280  192k AAC
 * - 30232  132k AAC
 * - 30216  64k AAC
 *
 * 30250 排在 30251 之前还是之后？B站音频流 id 不区分杜比与 Hi-Res 的优劣，
 * 默认排在 Hi-Res 之后（避免杜比音轨被当成首选导致老设备播放失败）。
 */
const AUDIO_ID_PRIORITY: Record<number, number> = {
  30251: 0, // Hi-Res 192kHz/24bit FLAC（需大会员 + 视频含 Hi-Res）
  30250: 1, // Dolby Audio 杜比音频（需大会员 + 视频含杜比音轨）
  30280: 2, // 192k AAC
  30232: 3, // 132k AAC
  30216: 4, // 64k AAC
};

/** 取音频流首选 URL（baseUrl 优先，回落 base_url，再回落 backupUrl[0]） */
const pickAudioUrl = (audio: BiliDashAudio): string => {
  return audio.baseUrl || audio.base_url || audio.backupUrl?.[0] || audio.backup_url?.[0] || "";
};

/** 取首个非空 cid（首选 data.cid，回落 data.pages[0].cid） */
const pickCid = (data: BiliViewResp["data"]): number => {
  if (typeof data?.cid === "number" && data.cid > 0) return data.cid;
  const fromPages = data?.pages?.find((p) => typeof p.cid === "number" && (p.cid as number) > 0);
  return fromPages?.cid ?? 0;
};

const song_url: BiliModule = async (params) => {
  const trackId = String(params.trackId ?? "").trim();
  if (!trackId) return { code: 400, url: "", message: "trackId required" };

  try {
    // 步骤1：取 cid
    const viewUrl = `${BILI_API_BASE}/x/web-interface/view?bvid=${encodeURIComponent(trackId)}`;
    const viewBody = await biliRequest<BiliViewResp>(viewUrl);
    if (viewBody.code !== 0) {
      bilibiliLog.warn(
        `[BILI-SONG_URL] view 失败: bvid=${trackId} code=${viewBody.code} msg=${viewBody.message ?? "-"}`,
      );
      return { code: 200, url: "", source: "bilibili" };
    }
    const cid = pickCid(viewBody.data);
    if (!cid) {
      bilibiliLog.warn(`[BILI-SONG_URL] 无可用 cid: bvid=${trackId}`);
      return { code: 200, url: "", source: "bilibili" };
    }

    // 步骤2：取 DASH 音频流
    const playUrl =
      `${BILI_API_BASE}/x/player/playurl` +
      `?bvid=${encodeURIComponent(trackId)}` +
      `&cid=${cid}` +
      `&fnval=16&fnver=0`;
    const playBody = await biliRequest<BiliPlayurlResp>(playUrl);
    if (playBody.code !== 0) {
      bilibiliLog.warn(
        `[BILI-SONG_URL] playurl 失败: bvid=${trackId} cid=${cid} code=${playBody.code} msg=${playBody.message ?? "-"}`,
      );
      return { code: 200, url: "", source: "bilibili" };
    }

    const audios = playBody.data?.dash?.audio ?? [];
    if (audios.length === 0) {
      bilibiliLog.warn(`[BILI-SONG_URL] 无音频流: bvid=${trackId} cid=${cid}`);
      return { code: 200, url: "", source: "bilibili" };
    }

    // 步骤3：按优先级选最优音频流
    const sorted = [...audios].sort((a, b) => {
      const pa = a.id !== undefined ? AUDIO_ID_PRIORITY[a.id] ?? 99 : 99;
      const pb = b.id !== undefined ? AUDIO_ID_PRIORITY[b.id] ?? 99 : 99;
      return pa - pb;
    });
    const best = sorted[0];
    const url = pickAudioUrl(best);
    if (!url) {
      bilibiliLog.warn(`[BILI-SONG_URL] 音频流无 baseUrl: bvid=${trackId} cid=${cid} id=${best.id}`);
      return { code: 200, url: "", source: "bilibili" };
    }

    bilibiliLog.info(
      `[BILI-SONG_URL] 命中: bvid=${trackId} cid=${cid} audioId=${best.id} ` +
        `isHiRes=${best.id === 30251}`,
    );
    return { code: 200, url, source: "bilibili" };
  } catch (err) {
    bilibiliLog.warn(`[BILI-SONG_URL] 取流异常: bvid=${trackId}`, err);
    return { code: 200, url: "", source: "bilibili" };
  }
};

export default song_url;
