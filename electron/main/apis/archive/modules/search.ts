/**
 * 搜索歌曲（Internet Archive / etree 集合）
 *
 * 端点：GET /advancedsearch.php?q=collection:etree+AND+(title:{kw}+OR+creator:{kw})
 *                              &fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=year&fl[]=mediatype
 *                              &output=json&rows={limit}&page={page}
 * 公开 API，完全无鉴权
 *
 * advancedsearch 返回的 title 字段已是完整曲目名（etree 一场演出对应一个 identifier，
 * 实际是「录音会」级别而非单曲），无需再二次调 /metadata 拉所有 files 详情（成本太高）。
 * 真正拉单文件 URL 由 song_url 模块按需调 /metadata/{id} 完成。
 *
 * params:
 * - keywords  关键词（必填）
 * - page      页码，默认 1（archive.org 的 page 从 1 起算）
 * - limit     每页数，默认 30
 */

import { ARCHIVE_API_BASE, decodeName } from "../core/config";
import { archiveRequest } from "../core/request";
import { archiveLog } from "@main/utils/logger";
import type { ArchiveModule } from "../core/types";

interface ArchiveSearchDoc {
  identifier?: string;
  title?: string;
  creator?: string | string[];
  date?: string;
  year?: string;
  mediatype?: string;
}

interface ArchiveSearchResp {
  response?: {
    numFound?: number;
    start?: number;
    docs?: ArchiveSearchDoc[];
  };
}

interface NormalizedSong {
  /** archive.org identifier（如 "GratefulDead-1972-..."） */
  id: string;
  title: string;
  artist: string;
  /** 与 id 相同：etree 一个 identifier 即一场演出 */
  album: string;
  albumId: string;
  /** archive.org 无标准封面字段，留 undefined 由后续 metadata 拉取时再补 */
  cover?: string;
  /** 毫秒，etree 元数据不返回时长，置 0 */
  duration: number;
  /** etree 集合现场录音统一按 mp3_320 标识 */
  qualities: string[];
}

const pickCreator = (raw: string | string[] | undefined): string => {
  if (!raw) return "";
  if (Array.isArray(raw)) return raw.filter(Boolean).join(", ");
  return raw;
};

const normalizeDoc = (doc: ArchiveSearchDoc): NormalizedSong => {
  const id = doc.identifier ?? "";
  const title = decodeName(doc.title ?? id);
  return {
    id,
    title,
    artist: decodeName(pickCreator(doc.creator)),
    album: title,
    albumId: id,
    cover: undefined,
    duration: 0,
    qualities: ["mp3_320"],
  };
};

const search: ArchiveModule = async (params) => {
  const { keywords, page = 1, limit = 30 } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
  };

  if (!keywords) {
    return { code: 400, total: 0, songs: [], message: "keywords required" };
  }

  // 注意 advancedsearch 的 q 表达式：collection:etree AND (title:{kw} OR creator:{kw})
  // archive.org 要求 AND/OR 必须大写；空格用 +（或 %20）编码
  const kw = encodeURIComponent(keywords);
  const q = `collection:etree AND (title:${kw} OR creator:${kw})`;

  const url =
    `${ARCHIVE_API_BASE}/advancedsearch.php` +
    `?q=${encodeURIComponent(q)}` +
    `&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=year&fl[]=mediatype` +
    `&output=json` +
    `&rows=${limit}` +
    `&page=${page}`;

  try {
    const body = await archiveRequest<ArchiveSearchResp>(url);
    const docs = body.response?.docs ?? [];
    const songs = docs.map(normalizeDoc);
    const total = body.response?.numFound ?? songs.length;
    archiveLog.info(
      `[ERR-13001-A] Archive 搜索成功: keywords="${keywords}" page=${page} hits=${songs.length}/${total}`,
    );
    return { code: 200, total, songs };
  } catch (err) {
    archiveLog.warn(`[ERR-13002-A] Archive 搜索失败: keywords="${keywords}"`, err);
    return { code: 200, total: 0, songs: [] };
  }
};

export default search;
