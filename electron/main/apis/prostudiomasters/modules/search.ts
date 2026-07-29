/**
 * 搜索歌曲（ProStudioMasters）
 *
 * 单路径策略：抓 https://www.prostudiomasters.com/search?q={kw} HTML
 *
 * - PSM 网页是 PHP 后端，HTML 内含曲目元数据，免登录可匿名抓取
 * - 解析 <div class="track"> 或类似结构，提取 data-track-id / data-title /
 *   data-preview-url 等公开标记
 * - 同时兼容 <audio>/<source> 标签内的 preview MP3 直链
 * - 解析失败时返回空数组，由调用方回落到其他音源
 *
 * 返回 Song[]，每首含 psm-preview hash（2 分钟 MP3 试听直链）供 song_url 模块使用。
 *
 * 错误码：[ERR-14201-A]（搜索失败 / 空结果）
 *
 * params:
 * - keywords  关键词（必填）
 * - page      页码，默认 1
 * - limit     每页数，默认 30
 */

import { psmLog } from "@main/utils/logger";
import { PSM_WEB_BASE, decodeName } from "../core/config";
import { psmRequestText } from "../core/request";
import type { PsmModule } from "../core/types";

interface PsmSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  /** PSM 试听固定 2 分钟 MP3；psm-preview hash 供 song_url 模块直接取 */
  hashes: Record<string, string>;
}

interface PsmSearchResult {
  code: number;
  total: number;
  songs: PsmSong[];
  message?: string;
}

/**
 * 从 HTML 中正则解析曲目列表
 *
 * PSM 网页结构（基于 prostudiomasters.com 公开搜索页观察推断）：
 * - 每首曲目以 <div class="track" data-track-id="..." data-title="..."
 *   data-artist="..." data-preview-url="..."> 形式渲染
 * - 同时兼容 class 含 "track-item" / "track-row" 等变体
 * - 同时兼容 <audio src> / <source src> 标签内的 preview MP3 直链
 *
 * 解析失败时返回空数组。
 */
const parseTracksFromHtml = (html: string): PsmSong[] => {
  const songs: PsmSong[] = [];

  // 匹配所有 class 含 "track" 的 div 起始标签
  const blockRe = /<div[^>]*class="[^"]*track[^"]*"[^>]*>/gi;
  // 在每个 track div 起始标签后取 1KB 窗口提取 data-* 属性
  const attrRe = /data-(track-id|title|artist|album|preview-url)="([^"]*)"/gi;

  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = blockRe.exec(html)) !== null) {
    const startIdx = blockMatch.index;
    const snippet = html.slice(startIdx, startIdx + 1024);

    const attrs: Record<string, string> = {};
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(snippet)) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }
    if (!attrs["track-id"]) continue;

    const previewUrl = decodeName(attrs["preview-url"] ?? "");
    const hashes: Record<string, string> = {};
    if (previewUrl) hashes["psm-preview"] = previewUrl;
    songs.push({
      id: decodeName(attrs["track-id"]),
      title: decodeName(attrs["title"] ?? ""),
      artist: decodeName(attrs["artist"] ?? ""),
      album: decodeName(attrs["album"] ?? ""),
      duration: 120, // PSM 试听固定 2 分钟
      hashes,
    });
  }

  // 补充：扫描独立的 <audio>/<source> 标签（部分页面不在 track div 内）
  if (songs.length === 0) {
    const audioRe = /<(?:audio|source)[^>]+src="([^"]+\.(?:mp3|m4a)[^"]*)"[^>]*>/gi;
    let audioMatch: RegExpExecArray | null;
    let idx = 0;
    while ((audioMatch = audioRe.exec(html)) !== null) {
      const url = decodeName(audioMatch[1]);
      if (!url) continue;
      songs.push({
        id: `audio-${idx++}`,
        title: "",
        artist: "",
        album: "",
        duration: 120,
        hashes: { "psm-preview": url },
      });
    }
  }

  psmLog.info(
    `[ERR-14201-A] PSM HTML 解析: 抓取 ${songs.length} 首曲目（HTML 共 ${html.length} 字节）`,
  );
  return songs;
};

/** 抓 HTML 公开搜索页（免登录，所有用户可用） */
const searchViaHtml = async (keywords: string): Promise<PsmSong[]> => {
  try {
    const url = `${PSM_WEB_BASE}/search?q=${encodeURIComponent(keywords)}`;
    const html = await psmRequestText(url);
    return parseTracksFromHtml(html);
  } catch (err) {
    psmLog.warn(
      `[ERR-14201-A] PSM HTML 搜索失败: keywords="${keywords}" reason=${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
};

const search: PsmModule = async (params) => {
  const { keywords, page = 1, limit = 30 } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
  };

  const kw = (keywords ?? "").trim();
  if (!kw) {
    return {
      code: 200,
      total: 0,
      songs: [],
      message: "keywords required",
    } satisfies PsmSearchResult;
  }

  psmLog.info(
    `[ERR-14201-A] PSM 搜索开始: keywords="${kw}" page=${page} limit=${limit}`,
  );

  // 抓 HTML 公开搜索页（所有用户可用，免登录）
  const songs = await searchViaHtml(kw);

  // 截断到 limit / page
  const start = (page - 1) * limit;
  const paged = songs.slice(start, start + limit);

  return {
    code: 200,
    total: songs.length,
    songs: paged,
  } satisfies PsmSearchResult;
};

export default search;
