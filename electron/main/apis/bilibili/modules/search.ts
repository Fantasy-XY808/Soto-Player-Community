/**
 * 搜索视频（Bilibili / video 类型）
 *
 * 端点：GET /x/web-interface/search/type?search_type=video&keyword={kw}&page={page}
 * 必须带 cookie 或 platform cookies 才能搜索（B站搜索需要登录态或 buvid3 cookie）。
 * 为免登录，请求层注入固定的 buvid3=placeholder cookie。
 *
 * 响应 data.result[] 字段：
 * - bvid      视频 BV 号（用作 song.id / albumId）
 * - title     含 <em class="keyword"> 高亮标签 + HTML 实体，需 decodeName 清洗
 * - author    UP 主名
 * - pic       封面（//i0.hdslb.com/...，无协议头，需补 https:）
 * - duration  "3:45" 字符串（分:秒），转毫秒
 *
 * 转成 NormalizedSong：{ id: bvid, title, artist: author, album: title, albumId: bvid, cover: pic, duration: 毫秒 }
 * qualities: ["mp3_128"]（B站默认非真母带，UI 标注）
 *
 * params:
 * - keywords  关键词（必填）
 * - page      页码，默认 1（B站 page 从 1 起算）
 * - limit     每页数（仅用于前端缓存键计算，B站 pagesize 固定 20）
 */

import { BILI_SEARCH_BASE, decodeName } from "../core/config";
import { biliRequest } from "../core/request";
import { bilibiliLog } from "@main/utils/logger";
import type { BiliModule } from "../core/types";

interface BiliSearchItem {
  bvid?: string;
  title?: string;
  author?: string;
  pic?: string;
  duration?: string;
}

interface BiliSearchResp {
  code?: number;
  message?: string;
  data?: {
    total?: number;
    result?: BiliSearchItem[];
  };
}

interface NormalizedSong {
  /** 视频 BV 号（BV1xx...） */
  id: string;
  title: string;
  artist: string;
  /** 与 title 相同：B站一个视频即一个可播放单元 */
  album: string;
  albumId: string;
  /** 封面 https://i0.hdslb.com/... */
  cover?: string;
  /** 毫秒 */
  duration: number;
  /** B站默认非真母带，UI 标注 */
  qualities: string[];
}

/** "3:45" → 毫秒；解析失败返回 0 */
const parseDuration = (raw: string | undefined): number => {
  if (!raw) return 0;
  const parts = raw.split(":").map((p) => Number(p.trim()));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  // 支持 "秒" / "分:秒" / "时:分:秒"
  let sec = 0;
  for (const part of parts) sec = sec * 60 + part;
  return sec * 1000;
};

/** 封面 URL 补协议头：B站返回 //i0.hdslb.com/... 形式 */
const normalizePic = (pic: string | undefined): string | undefined => {
  if (!pic) return undefined;
  if (pic.startsWith("//")) return `https:${pic}`;
  if (pic.startsWith("http")) return pic;
  return `https://${pic}`;
};

const normalizeItem = (item: BiliSearchItem): NormalizedSong => {
  const bvid = item.bvid ?? "";
  const title = decodeName(item.title);
  return {
    id: bvid,
    title,
    artist: decodeName(item.author),
    album: title,
    albumId: bvid,
    cover: normalizePic(item.pic),
    duration: parseDuration(item.duration),
    qualities: ["mp3_128"],
  };
};

const search: BiliModule = async (params) => {
  const { keywords, page = 1 } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
  };

  if (!keywords) {
    return { code: 400, total: 0, songs: [], message: "keywords required" };
  }

  const url =
    `${BILI_SEARCH_BASE}` +
    `?search_type=video` +
    `&keyword=${encodeURIComponent(keywords)}` +
    `&page=${page}`;

  try {
    const body = await biliRequest<BiliSearchResp>(url);
    // B站成功码是 0
    if (body.code !== 0) {
      bilibiliLog.warn(
        `[BILI-SEARCH] 搜索失败: keywords="${keywords}" code=${body.code} msg=${body.message ?? "-"}`,
      );
      return { code: 200, total: 0, songs: [] };
    }
    const items = body.data?.result ?? [];
    const songs = items.map(normalizeItem).filter((s) => s.id);
    const total = body.data?.total ?? songs.length;
    bilibiliLog.info(
      `[BILI-SEARCH] 搜索成功: keywords="${keywords}" page=${page} hits=${songs.length}/${total}`,
    );
    return { code: 200, total, songs };
  } catch (err) {
    bilibiliLog.warn(`[BILI-SEARCH] 搜索异常: keywords="${keywords}"`, err);
    return { code: 200, total: 0, songs: [] };
  }
};

export default search;
