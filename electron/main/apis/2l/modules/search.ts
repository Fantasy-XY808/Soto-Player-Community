/**
 * 搜索曲目（2L 免费样品）
 *
 * 端点：GET https://www.2l.no/hires/index.html（静态 HTML）
 * 解析：用正则扫描 <a href="*.flac|*.dsf|*.dff|*.wav"> 直链，结合 <tr> 行上下文
 *      提取 title / artist / album（与 archive 模式一致：HTML 解析、无鉴权、无登录）
 *
 * 关键约束：
 * - 2L 是免费样品，无需登录（与 mora/psm 的付费登录模式不同）
 * - 禁止曲库收录：UI 必须标注「试听曲目，禁止曲库收录」
 * - 不引入 cheerio，纯正则解析
 * - DXD/DSD 文件走 ffmpeg_audio 原生解码（已支持），无需额外处理
 *
 * 注意：2L 官网曾于 2024-2025 期间下线 Test Bench 页面（"free Test Bench is currently not
 * available"）。检测到该提示文案时，自动回落到 Wayback Machine 2024 年历史快照（
 * https://web.archive.org/web/2024/https://www.2l.no/hires/index.html）继续解析；
 * 快照也命中下线文案或拉取失败时才返回 0 结果。
 *
 * params:
 * - keywords  关键词（可选；为空时返回全量曲目，按 page/limit 分页）
 * - page      页码，默认 1
 * - limit     每页数，默认 30
 */

import { TWO_L_API_BASE, TWO_L_SAMPLE_INDEX, decodeName } from "../core/config";
import { twoLRequestText } from "../core/request";
import { fetchWaybackHtml, isTestBenchOffline, WAYBACK_ORIGIN } from "../core/wayback";
import { twoLLog } from "@main/utils/logger";
import type { TwoLModule } from "../core/types";

interface TwoLSampleSong {
  /** 2L 试听曲目 id（基于 title slug 化，前缀 "2l-"） */
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  cover?: string;
  /** 2L 不提供时长元数据，留 0 */
  duration: number;
  /** 默认标 "flac_24bit_192k"（2L 主打 Hi-Res 24bit/192kHz 与 DSD） */
  qualities: string[];
  /**
   * 直链传递：song_url 模块直接返回 hashes["2l-url"]
   * 与 kugou 的多品质 hash 字典一致设计
   */
  hashes: Record<string, string>;
}

/** 音频文件扩展名匹配（FLAC / DSF / DFF / WAV；不区分大小写） */
const AUDIO_EXT_RE = /\.(flac|dsf|dff|wav)(?:$|[?#])/i;

/**
 * 把任意 HTML 片段中的标签剥成纯文本（粗略：去标签 + 折叠空白）
 * 仅用于从表格单元格提取可见文本，不严格符合 HTML 规范
 */
const stripTags = (html: string): string =>
  decodeName(html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim());

/**
 * 把标题文本 slug 化为 id（小写、连字符分隔、仅 a-z0-9）
 * 截断到 64 字符，避免长标题导致 cache key 过长
 */
const slugify = (s: string): string => {
  const slug = s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // 去变音符号
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "track";
};

/**
 * 把相对 URL 转成绝对 URL
 * - http(s):// 开头：原样返回（含 Wayback 完整 URL）
 * - /web/{digits}/ 开头：Wayback 重写后的相对路径，补 https://web.archive.org
 * - // 开头：补 https:
 * - / 开头：补 TWO_L_API_BASE
 * - 其他（相对路径）：补 TWO_L_API_BASE + "/"
 *
 * Wayback 抓取的 HTML 中，原 2L 音频直链会被 Wayback 改写为
 * /web/{timestamp}/https://www.2l.no/hires/xxx.flac 形式，必须补全为
 * https://web.archive.org/web/{timestamp}/... 才能被播放器拉取。
 */
const absolutize = (href: string): string => {
  if (/^https?:\/\//i.test(href)) return href;
  if (/^\/web\/\d+\//i.test(href)) return `${WAYBACK_ORIGIN}${href}`;
  if (/^\/\//.test(href)) return `https:${href}`;
  if (/^\//.test(href)) return `${TWO_L_API_BASE}${href}`;
  return `${TWO_L_API_BASE}/${href}`;
};

/** 提取 <a href="..."> 中的 href（解码 &amp; 等实体） */
const extractHref = (anchorTag: string): string => {
  const m = anchorTag.match(/href\s*=\s*"([^"]+)"/i);
  if (!m) return "";
  return decodeName(m[1]);
};

/** 提取 <a ...>text</a> 中的可见文本 */
const extractAnchorText = (anchorTag: string): string => stripTags(anchorTag);

/**
 * 在一个 <tr> 行 HTML 内匹配所有 <a href> 链接，分离出音频直链与专辑链接
 * - 音频链接：href 后缀 .flac/.dsf/.dff/.wav
 * - 专辑链接：第一个非音频的 https? 链接（通常指向 shop.klicktrack.com / shop.2l.no）
 */
interface RowLinks {
  audioUrls: string[];
  albumUrl: string;
  albumName: string;
}

const parseRowLinks = (rowHtml: string): RowLinks => {
  const audioUrls: string[] = [];
  let albumUrl = "";
  let albumName = "";

  const anchorRe = /<a\b[^>]*>(?:[\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(rowHtml)) !== null) {
    const anchor = m[0];
    const href = extractHref(anchor);
    if (!href) continue;
    if (AUDIO_EXT_RE.test(href)) {
      audioUrls.push(absolutize(href));
    } else if (!albumUrl && /^https?:\/\//i.test(href)) {
      albumUrl = href;
      albumName = extractAnchorText(anchor);
    }
  }
  return { audioUrls, albumUrl, albumName };
};

/**
 * 从 <tr> 第一行单元格提取 title + artist
 * 2L 表格首列结构：`{title} <strong>{performer}</strong>` 或 `{title} <b>{performer}</b>`
 * - 偶尔 performer 在 <br> 后续；偶尔仅有 title（artist 留 "2L Records"）
 */
const parseTitleArtist = (rowHtml: string): { title: string; artist: string } => {
  // 取第一个 <td>...</td>（含嵌套标签）
  const cellMatch = rowHtml.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
  const cellHtml = cellMatch ? cellMatch[1] : rowHtml;

  // 优先：title 前置文本 + <strong|b>performer</strong|b>
  const strongMatch = cellHtml.match(
    /^\s*([^<]+?)\s*(?:<(?:strong|b)\b[^>]*>([^<]+)<\/(?:strong|b)>)?/i,
  );
  const title = strongMatch ? strongMatch[1].trim() : "";
  const artist = strongMatch && strongMatch[2] ? strongMatch[2].trim() : "";

  // 兜底：若 strong 未匹配到，取 stripTags 后的第一段（按 / 或 - 切分）
  if (!title) {
    const text = stripTags(cellHtml);
    const parts = text.split(/\s*[/\-–—]\s*/);
    return {
      title: decodeName(parts[0] || text || "Untitled").trim(),
      artist: parts[1] ? decodeName(parts[1]).trim() : "2L Records",
    };
  }

  return {
    title: decodeName(title),
    artist: artist ? decodeName(artist) : "2L Records",
  };
};

/**
 * 按流式播放友好度排序音频 URL：
 * 1. 88/96kHz 24bit FLAC（体积适中，最易起播）
 * 2. 176/192kHz 24bit FLAC（Hi-Res 标准档）
 * 3. 352.8kHz DXD FLAC（极高质量但体积大）
 * 4. 任意 .flac
 * 5. .dsf / .dff（DSD，需 ffmpeg_audio 解码）
 * 6. .wav
 */
const pickPreferredUrl = (urls: string[]): string => {
  if (urls.length === 0) return "";
  const patterns: RegExp[] = [
    /(?:88k|96k|88kHz|96kHz)[^_./]*\.flac$/i,
    /(?:176k|192k|176kHz|192kHz)[^_./]*\.flac$/i,
    /(?:352|dxd)[^_./]*\.flac$/i,
    /\.flac$/i,
    /\.dsf$/i,
    /\.dff$/i,
    /\.wav$/i,
  ];
  for (const re of patterns) {
    const hit = urls.find((u) => re.test(u));
    if (hit) return hit;
  }
  return urls[0];
};

/** 把单个 <tr> 行解析为 TwoLSampleSong；无音频直链的行返回 null（表头/分隔行） */
const parseRow = (rowHtml: string): TwoLSampleSong | null => {
  const links = parseRowLinks(rowHtml);
  if (links.audioUrls.length === 0) return null;

  const { title, artist } = parseTitleArtist(rowHtml);
  const album = links.albumName || "2L Hi-Res Sample";
  const url = pickPreferredUrl(links.audioUrls);

  return {
    id: `2l-${slugify(title) || slugify(album)}`,
    title: title || "Untitled",
    artist: artist || "2L Records",
    album,
    albumId: links.albumUrl,
    cover: undefined,
    duration: 0,
    qualities: ["flac_24bit_192k"],
    hashes: { "2l-url": url },
  };
};

const search: TwoLModule = async (params) => {
  const { keywords, page = 1, limit = 30 } = params as {
    keywords?: string;
    page?: number;
    limit?: number;
  };

  const url = `${TWO_L_API_BASE}${TWO_L_SAMPLE_INDEX}`;

  try {
    let html = await twoLRequestText(url);
    let usedWayback = false;

    // 检测 2L 官网 "Test Bench 已下线" 提示文案（2024-2025 期间下线）
    // 命中则尝试 Wayback Machine 2024 年历史快照兜底
    if (isTestBenchOffline(html)) {
      twoLLog.warn(
        `[ERR-14001-A] 2L Test Bench 已下线（官网 renovating），尝试 Wayback 兜底: keywords="${keywords ?? "-"}"`,
      );
      const waybackHtml = await fetchWaybackHtml();
      if (waybackHtml) {
        html = waybackHtml;
        usedWayback = true;
      } else {
        return {
          code: 200,
          total: 0,
          songs: [],
          message: "2L Test Bench is currently not available (personal trial mode only)",
        };
      }
    }

    // 扫描所有 <tr> 行
    const rows: string[] = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) {
      rows.push(m[1]);
    }

    const allSongs = rows
      .map(parseRow)
      .filter((s): s is TwoLSampleSong => s !== null);

    // 关键词过滤（标题/艺术家/专辑任一命中，大小写不敏感）
    const kw = (keywords ?? "").trim().toLowerCase();
    const filtered = kw
      ? allSongs.filter(
          (s) =>
            s.title.toLowerCase().includes(kw) ||
            s.artist.toLowerCase().includes(kw) ||
            s.album.toLowerCase().includes(kw),
        )
      : allSongs;

    // 分页
    const start = Math.max(0, (page - 1) * limit);
    const paged = filtered.slice(start, start + limit);

    twoLLog.info(
      `[ERR-14001-A] 2L 试听样品搜索成功: keywords="${keywords ?? "-"}" page=${page} ` +
        `hits=${paged.length}/${filtered.length} (parsed=${allSongs.length})` +
        (usedWayback ? " source=wayback" : ""),
    );

    return {
      code: 200,
      total: filtered.length,
      songs: paged,
      message: "2L free Hi-Res samples (personal trial mode only)",
    };
  } catch (err) {
    twoLLog.warn(`[ERR-14001-A] 2L 试听样品索引抓取失败: url=${url}`, err);
    return {
      code: 200,
      total: 0,
      songs: [],
      message: "2L sample index unavailable (personal trial mode only)",
    };
  }
};

export default search;
