/**
 * 元数据行清理器
 *
 * 用于清理歌词中开头和结尾的元数据行，例如：
 *
 * (歌曲名) - (歌手名)
 * 词：...
 * 曲：...
 * 编曲：...
 * 制作人：...
 * 真正的歌词行 1
 * 真正的歌词行 2
 */

import type { LyricLine } from "@shared/types/lyrics";
import type { Track } from "@shared/types/player";
import { useSettingsStore } from "@/stores/settings";
import {
  keywords as defaultExcludeKeywords,
  regexes as defaultExcludeRegexes,
} from "./excludeRules";

const STRICT_MATCH_SEPARATORS = new Set([
  ":",
  "：",
  ",",
  "，",
  ".",
  "。",
  "!",
  "！",
  "-",
  "_",
  "(",
  "（",
  "[",
  "【",
  "{",
  "『",
  "「",
]);

/** 扫描限制配置 */
interface ScanLimitConfig {
  /** 扫描比例 (0.0 - 1.0) */
  ratio: number;
  /** 最小扫描行数 */
  minLines: number;
  /** 最大扫描行数 */
  maxLines: number;
}

/** 歌词清理配置 */
export interface StripOptions {
  /** 关键词列表 */
  keywords: string[];
  /** 正则字符串列表 */
  regexPatterns: string[];
  /** 弱匹配正则 */
  softMatchRegexes?: string[];
  /** 用于检查第一行是否为「歌曲 - 歌手」格式 */
  matchMetadata?: {
    title?: string;
    artists?: string[];
  };
}

const DEFAULT_HEADER_LIMIT: ScanLimitConfig = {
  ratio: 0.2,
  minLines: 20,
  maxLines: 70,
};

const DEFAULT_FOOTER_LIMIT: ScanLimitConfig = {
  ratio: 0.2,
  minLines: 20,
  maxLines: 50,
};

const calculateScanLimit = (config: ScanLimitConfig, totalLines: number): number => {
  const proportional = Math.ceil(totalLines * config.ratio);
  const clamped = Math.max(config.minLines, Math.min(proportional, config.maxLines));
  return Math.min(clamped, totalLines);
};

const getLineText = (line: LyricLine): string => {
  if (!line || !line.words) return "";
  return line.words
    .map((w) => w.word)
    .join("")
    .trim();
};

/** 移除行首尾的括号，例如 (作曲: xxx) -> 作曲: xxx */
const cleanTextForCheck = (text: string): string => {
  let processed = text.trim();
  const brackets: ReadonlyArray<readonly [string, string]> = [
    ["(", ")"],
    ["（", "）"],
    ["【", "】"],
    ["[", "]"],
    ["{", "}"],
    ["『", "』"],
    ["「", "」"],
  ];

  let changed = true;
  let loopCount = 0;
  while (changed && loopCount < 5) {
    changed = false;
    loopCount++;
    for (const [open, close] of brackets) {
      if (processed.startsWith(open)) {
        // (作曲：周杰伦) 这种完全包裹
        if (processed.endsWith(close)) {
          processed = processed.slice(open.length, processed.length - close.length).trim();
          changed = true;
          break;
        }
        // (Live) 作曲：周杰伦 这种前置标记
        const closeIdx = processed.indexOf(close);
        if (closeIdx > -1) {
          const contentAfter = processed.slice(closeIdx + close.length).trim();
          if (contentAfter.length > 0) {
            processed = contentAfter;
            changed = true;
            break;
          }
        }
      }
    }
  }
  return processed;
};

const normalizeKw = (s: string): string => s.toLowerCase().replace(/\s+/g, "");

/**
 * 强匹配：关键词加冒号或匹配正则
 * 弱匹配：带有冒号但不匹配关键词或正则。夹在强匹配之间多半是元数据，但也可能是“男：…”这样的演唱者标识
 *        所以仅当后续仍是强匹配时才删除
 * 真正歌词行：既不匹配规则，也无冒号 -> 防火墙，阻止误删
 *
 * @param normalizedKeywords 预 normalize（小写 + 去空格）好的关键词，避免每行重复处理
 */
const isStrictMatch = (
  text: string,
  normalizedKeywords: readonly string[],
  regexes: readonly RegExp[],
): boolean => {
  const cleaned = cleanTextForCheck(text);
  const normalizedText = normalizeKw(cleaned);

  for (const kw of normalizedKeywords) {
    if (normalizedText.startsWith(kw)) {
      if (normalizedText.length === kw.length) return true;
      if (STRICT_MATCH_SEPARATORS.has(normalizedText.charAt(kw.length))) return true;
    }
  }
  for (const reg of regexes) {
    if (reg.test(text)) return true;
  }
  return false;
};

const looksLikeMetadata = (text: string, softRegexes: readonly RegExp[]): boolean => {
  const cleaned = cleanTextForCheck(text);
  if (cleaned.includes(":") || cleaned.includes("：") || cleaned.includes("-")) return true;
  for (const reg of softRegexes) {
    if (reg.test(text)) return true;
  }
  return false;
};

/** 头部扫描，寻找正文开始位置 */
const findHeaderCutoff = (
  lines: readonly LyricLine[],
  startIndex: number,
  normalizedKeywords: readonly string[],
  regexes: readonly RegExp[],
  softRegexes: readonly RegExp[],
  limit: number,
): number => {
  let lastValidMetadataIndex = startIndex - 1;
  for (let i = startIndex; i < limit; i++) {
    if (i >= lines.length) break;
    const text = getLineText(lines[i]);
    if (!text) continue;
    const strict = isStrictMatch(text, normalizedKeywords, regexes);
    const weak = looksLikeMetadata(text, softRegexes);
    if (!strict && !weak) break;
    if (strict) lastValidMetadataIndex = i;
  }
  return lastValidMetadataIndex + 1;
};

/** 尾部扫描，寻找正文结束位置 */
const findFooterCutoff = (
  lines: readonly LyricLine[],
  startIndex: number,
  normalizedKeywords: readonly string[],
  regexes: readonly RegExp[],
  softRegexes: readonly RegExp[],
  limit: number,
): number => {
  if (startIndex >= lines.length) return startIndex;
  const scanEnd = Math.max(startIndex, lines.length - limit);
  let firstValidFooterIndex = lines.length;
  for (let i = lines.length - 1; i >= scanEnd; i--) {
    const text = getLineText(lines[i]);
    if (!text) continue;
    const strict = isStrictMatch(text, normalizedKeywords, regexes);
    const weak = looksLikeMetadata(text, softRegexes);
    if (!strict && !weak) break;
    if (strict) firstValidFooterIndex = i;
  }
  return firstValidFooterIndex;
};

/**
 * 剥离歌词中的元数据行
 * @param lines   原始歌词行
 * @param options 关键词 / 正则 / 元数据匹配
 */
export const stripLyricMetadata = (
  lines: readonly LyricLine[],
  options: StripOptions,
): LyricLine[] => {
  if (!lines || lines.length === 0) return [];

  let scanStartIndex = 0;
  if (options.matchMetadata) {
    const { title, artists } = options.matchMetadata;
    const firstLineText = getLineText(lines[0]);
    if (title && artists && artists.length > 0 && firstLineText) {
      const lowerText = firstLineText.toLowerCase();
      const lowerTitle = title.toLowerCase();
      if (lowerText.includes(lowerTitle)) {
        const hasAnyArtist = artists.some((artist) => lowerText.includes(artist.toLowerCase()));
        if (hasAnyArtist) scanStartIndex = 1;
      }
    }
  }

  if (
    scanStartIndex === 0 &&
    (!options.keywords || options.keywords.length === 0) &&
    (!options.regexPatterns || options.regexPatterns.length === 0) &&
    (!options.softMatchRegexes || options.softMatchRegexes.length === 0)
  ) {
    return lines as LyricLine[];
  }

  const regexes: RegExp[] = [];
  options.regexPatterns?.forEach((p) => {
    try {
      if (p.trim()) regexes.push(new RegExp(p, "i"));
    } catch (e) {
      console.warn(`[lyricStripper] 无效的正则表达式: ${p}`, e);
    }
  });

  const softRegexes: RegExp[] = [];
  options.softMatchRegexes?.forEach((p) => {
    try {
      if (p.trim()) softRegexes.push(new RegExp(p, "i"));
    } catch (e) {
      console.warn(`[lyricStripper] 无效的弱匹配正则: ${p}`, e);
    }
  });

  // 提前对所有关键词做一次 normalize，避免每行扫描重复 toLowerCase / replace
  const normalizedKeywords = (options.keywords ?? []).map(normalizeKw);
  const totalLines = lines.length;

  const headerLimit = calculateScanLimit(DEFAULT_HEADER_LIMIT, totalLines);
  const startIdx = findHeaderCutoff(
    lines,
    scanStartIndex,
    normalizedKeywords,
    regexes,
    softRegexes,
    headerLimit,
  );

  const footerLimit = calculateScanLimit(DEFAULT_FOOTER_LIMIT, totalLines);
  const endIdx = findFooterCutoff(
    lines,
    startIdx,
    normalizedKeywords,
    regexes,
    softRegexes,
    footerLimit,
  );

  // 没有切除任何头尾时直接返回原数组引用，避免无谓拷贝
  if (startIdx === 0 && endIdx === lines.length) return lines as LyricLine[];

  return lines.slice(startIdx, endIdx);
};

/**
 * 清理歌词元数据行
 * @param lines 解析后的歌词行
 * @param track 当前歌曲（用于检测「歌曲 - 歌手」首行）
 */
export const applyLyricExclude = (lines: LyricLine[], track: Track | null): LyricLine[] => {
  if (lines.length === 0) return lines;

  const settings = useSettingsStore().lyric;
  if (!settings.enableExcludeLyrics) return lines;

  const mergedKeywords = [
    ...new Set([...defaultExcludeKeywords, ...settings.excludeLyricsUserKeywords]),
  ];
  const mergedRegexes = [
    ...new Set([...defaultExcludeRegexes, ...settings.excludeLyricsUserRegexes]),
  ];

  const artistNames = track?.artists?.map((a) => a.name).filter(Boolean) ?? [];

  return stripLyricMetadata(lines, {
    keywords: mergedKeywords,
    regexPatterns: mergedRegexes,
    matchMetadata: {
      title: track?.title || undefined,
      artists: artistNames,
    },
  });
};
