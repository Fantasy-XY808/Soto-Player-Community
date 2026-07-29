/**
 * 歌词解析编排服务
 *
 * 职责：
 * - 合并多源歌词（原文 + 翻译 + 罗马音）
 * - 从多个歌词源中选择最佳结果
 */
import type { LyricLine } from "@shared/types/lyrics";

export interface LyricSourceResult {
  sourceId: string;
  lines: LyricLine[];
  quality: number;
}

/** 按时间戳合并两份歌词，保留时间顺序 */
export const mergeLyricLines = (a: LyricLine[], b: LyricLine[]): LyricLine[] => {
  const result: LyricLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i].startTime <= b[j].startTime) {
      result.push(a[i]);
      i++;
    } else {
      result.push(b[j]);
      j++;
    }
  }
  while (i < a.length) result.push(a[i++]);
  while (j < b.length) result.push(b[j++]);
  return result;
};

/** 时间戳容差（毫秒），用于匹配翻译/罗马音 */
const TIME_TOLERANCE_MS = 100;

/** 从一行歌词提取纯文本 */
const lineText = (line: LyricLine): string =>
  line.words.map((w) => w.word).join("");

/** 按时间戳匹配翻译到原文 */
export const mergeTranslations = (
  original: LyricLine[],
  translation: LyricLine[],
): LyricLine[] => {
  return original.map((line) => {
    const match = translation.find((t) => Math.abs(t.startTime - line.startTime) <= TIME_TOLERANCE_MS);
    return match ? { ...line, translatedLyric: lineText(match) } : line;
  });
};

/** 按时间戳匹配罗马音到原文 */
export const mergeRomanization = (
  original: LyricLine[],
  romanization: LyricLine[],
): LyricLine[] => {
  return original.map((line) => {
    const match = romanization.find((r) => Math.abs(r.startTime - line.startTime) <= TIME_TOLERANCE_MS);
    return match ? { ...line, romanLyric: lineText(match) } : line;
  });
};

/** 从多个歌词源中选择最佳结果（行数多优先，同行数质量高优先） */
export const pickBestLyricSource = (
  sources: LyricSourceResult[],
): LyricSourceResult | null => {
  if (sources.length === 0) return null;
  return sources.reduce((best, current) => {
    if (current.lines.length > best.lines.length) return current;
    if (current.lines.length === best.lines.length && current.quality > best.quality) return current;
    return best;
  });
};
