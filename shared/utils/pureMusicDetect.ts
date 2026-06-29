import type { LyricLine } from "@shared/types/lyrics";

/** 信息性行关键词 */
const INFO_KEYWORDS = ["作词", "作曲", "编曲", "歌词", "获取", "来源", "演唱", "混音", "制作"];

/** 纯音乐关键词（任意命中即视为纯音乐） */
const PURE_MUSIC_KEYWORDS = ["纯音乐", "instrumental", "Instrumental", "INSTRUMENTAL"];

/** 判断是否为信息性行 */
function isInformationalLine(text: string): boolean {
  return INFO_KEYWORDS.some((k) => text.includes(k));
}

/**
 * 提取歌词中的有效内容行（去除空行与信息行）
 */
function extractContentLines(lines: LyricLine[]): string[] {
  return lines
    .map((line) =>
      line.words
        .map((w) => w.word)
        .join("")
        .trim(),
    )
    .filter((text) => text.length > 0 && !isInformationalLine(text));
}

/**
 * 检测歌词是否为纯音乐
 *
 * 判定规则（任一命中即视为纯音乐）：
 *   1. 任一内容行包含"纯音乐"/"instrumental" 等关键词（覆盖"纯音乐，请欣赏"/"此歌曲为纯音乐"等多种文案）
 *   2. 过滤信息行后无任何内容行（即"无歌词"场景）
 *
 * 与 dynamic-island 的 isInstrumental 判定保持一致，避免同一首歌在不同入口判定结果不同
 * @param lines - 歌词行数组
 * @returns 是否为纯音乐
 */
export function isPureMusic(lines: LyricLine[]): boolean {
  const contentLines = extractContentLines(lines);
  if (contentLines.length === 0) return true;
  return contentLines.some((text) => PURE_MUSIC_KEYWORDS.some((k) => text.includes(k)));
}
