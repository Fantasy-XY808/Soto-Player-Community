/**
 * 搜索歌曲（mora）
 *
 * 接口：GET https://mora.jp/search/getResult?keyWord={kw}
 *
 * 流程（基于实地抓包验证，2026-07-11）：
 * 1. 调用 moraRequest 拿 JSON：{ head:{successFlg:"1"}, data:{ trackResult:{ list:[...] } } }
 * 2. 每个 track 含字段：materialNo / trackTitle / artistName / packageTitle /
 *    packageId / packagePage / artistPage / weblistsizeimage / duration /
 *    listenFlg / mediaFormatNo / samplingFreq / bitPerSample 等
 * 3. 规范化为 Song[]：
 *    - id           ← materialNo（字符串形式，如 "47299924"）
 *    - title        ← trackTitle
 *    - artist       ← artistName
 *    - album        ← packageTitle
 *    - albumId      ← packageId（字符串形式）
 *    - cover        ← weblistsizeimage（缩略图 URL）
 *    - duration     ← duration * 1000（mora 返回秒，前端用毫秒）
 *    - qualities    ← 基于 mediaFormatNo / samplingFreq / bitPerSample 推断
 *    - hashes["mora-materialNo"] ← materialNo（供 song_url 模块调 listenDownload 接口）
 *    - hashes["mora-listenFlg"]  ← listenFlg（1 可试听，0 不可试听）
 *
 * 接口限制：mora 的 getResult 接口固定返回最多 10 条综合结果（含 artist/album/track/keyword），
 * 不支持分页参数；page>1 时本模块返回空数组（让上层切换到下一页时显示"无更多结果"）。
 *
 * 试听免登录：所有用户都能搜 + 调 listenDownload 听 AAC 试听
 * 完整流 D 级不接入：mora 是下载商店，无流媒体能力
 *
 * params:
 * - keywords  关键词（必填）
 * - page      页码，默认 1（仅首页有结果）
 * - limit     每页数，默认 30（用于在解析后裁剪，不传入 URL）
 */

import { MORA_API_BASE, MORA_MEDIA_FORMAT, MORA_SEARCH_PATH, decodeName } from "../core/config";
import { moraRequest } from "../core/request";
import { moraLog } from "@main/utils/logger";
import type { MoraModule } from "../core/types";

/** mora 搜索接口返回的原始 JSON 结构（仅列出关注的字段） */
interface MoraSearchResp {
  head?: { successFlg?: string; message?: string };
  data?: {
    trackResult?: {
      total?: number;
      list?: MoraTrackRaw[];
    };
  };
}

interface MoraTrackRaw {
  materialNo?: unknown;
  trackTitle?: unknown;
  artistName?: unknown;
  packageTitle?: unknown;
  packageId?: unknown;
  packagePage?: unknown;
  weblistsizeimage?: unknown;
  duration?: unknown;
  listenFlg?: unknown;
  mediaFormatNo?: unknown;
  samplingFreq?: unknown;
  bitPerSample?: unknown;
  mediaType?: unknown;
}

interface NormalizedSong {
  /** mora track materialNo（字符串形式） */
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  /** 缩略图 URL */
  cover: string;
  /** 毫秒 */
  duration: number;
  /** 多品质 hash 字典：mora-materialNo 供 song_url 模块调 listenDownload */
  hashes: Record<string, string>;
  /** 品质档位列表，供 UI 展示该曲目支持的最高品质 */
  qualities: string[];
}

const asString = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return "";
};

const asNumber = (v: unknown): number => {
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  return 0;
};

/**
 * 基于 mediaFormatNo / samplingFreq / bitPerSample 推断品质档位
 *
 * 实地验证：
 * - mediaFormatNo=10  → AAC-LC 320kbps
 * - mediaFormatNo=11  → AVC/H.264 视频
 * - mediaFormatNo=12  → Hi-Res FLAC（含 samplingFreq/bitPerSample）
 * - mediaFormatNo=13  → DSD（DSF/DFF，mediaType=9/10）
 * - mediaFormatNo=15  → Lossless FLAC
 */
const inferQualities = (raw: MoraTrackRaw): string[] => {
  const fmt = asNumber(raw.mediaFormatNo);
  const freq = asNumber(raw.samplingFreq);
  const bits = asNumber(raw.bitPerSample);
  const q: string[] = [];

  if (fmt === MORA_MEDIA_FORMAT.AAC_MUSIC) {
    q.push("aac_320k");
  } else if (fmt === MORA_MEDIA_FORMAT.FLAC_LOSSLESS) {
    q.push("flac_lossless");
  } else if (fmt === MORA_MEDIA_FORMAT.FLAC_HIRES) {
    // Hi-Res：按采样率/位深细化档位
    const khz = freq > 0 ? Math.floor((freq / 1000) * 10) / 10 : 0;
    if (khz >= 192 && bits >= 24) q.push("flac_24bit_192k");
    else if (khz >= 96 && bits >= 24) q.push("flac_24bit_96k");
    else q.push("flac_hires");
  } else if (fmt === MORA_MEDIA_FORMAT.DSD) {
    q.push("dsd");
  }
  return q;
};

const normalizeTrack = (raw: MoraTrackRaw): NormalizedSong | null => {
  const id = asString(raw.materialNo);
  const title = asString(raw.trackTitle);
  if (!id || !title) return null;

  const durationSec = asNumber(raw.duration);
  const hashes: Record<string, string> = {
    "mora-materialNo": id,
  };
  const listenFlg = asNumber(raw.listenFlg);
  if (listenFlg) hashes["mora-listenFlg"] = String(listenFlg);

  return {
    id,
    title: decodeName(title),
    artist: decodeName(asString(raw.artistName)),
    album: decodeName(asString(raw.packageTitle)),
    albumId: asString(raw.packageId),
    cover: asString(raw.weblistsizeimage),
    duration: durationSec * 1000,
    hashes,
    qualities: inferQualities(raw),
  };
};

const search: MoraModule = async (params) => {
  const { keywords, page = 1, limit = 30 } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
  };

  if (!keywords) {
    return { code: 400, total: 0, songs: [], message: "keywords required" };
  }

  const url = `${MORA_API_BASE}${MORA_SEARCH_PATH}?keyWord=${encodeURIComponent(keywords)}`;

  try {
    const body = await moraRequest<MoraSearchResp>(url);

    // 校验 head.successFlg
    if (body.head?.successFlg !== "1") {
      moraLog.warn(
        `[ERR-14101-A] mora 搜索接口返回失败: keywords="${keywords}" msg=${body.head?.message ?? "-"}`,
      );
      return { code: 200, total: 0, songs: [] };
    }

    const trackList = body.data?.trackResult?.list ?? [];
    const total = body.data?.trackResult?.total ?? trackList.length;

    const allSongs: NormalizedSong[] = [];
    for (const raw of trackList) {
      const song = normalizeTrack(raw);
      if (song) allSongs.push(song);
    }

    // page/limit 裁剪（getResult 接口固定返回 ≤10 条，page>1 时为空）
    const offset = (page - 1) * limit;
    const songs = allSongs.slice(offset, offset + limit);

    moraLog.info(
      `[ERR-14101-A] mora 搜索成功: keywords="${keywords}" page=${page} hits=${songs.length}/${total}`,
    );
    return { code: 200, total, songs };
  } catch (err) {
    moraLog.warn(`[ERR-14101-A] mora 搜索失败: keywords="${keywords}"`, err);
    return { code: 200, total: 0, songs: [] };
  }
};

export default search;
