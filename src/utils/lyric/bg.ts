import type { LyricWord } from "@shared/types/lyrics";

/** 行首括号（全 / 半角） */
const OPEN_PAREN_RE = /^[（(]/;

/** 行尾括号（全 / 半角） */
const CLOSE_PAREN_RE = /[）)]$/;

/**
 * 检测整行是否为背景人声并就地剥离包裹括号
 * @param words - 行内单词数组，命中时原地修改首尾单词
 * @returns 是否为背景人声行
 */
export const detectBackgroundLine = (words: LyricWord[]): boolean => {
  if (words.length === 0) return false;
  const first = words[0];
  const last = words[words.length - 1];
  if (!OPEN_PAREN_RE.test(first.word) || !CLOSE_PAREN_RE.test(last.word)) return false;
  first.word = first.word.replace(OPEN_PAREN_RE, "");
  last.word = last.word.replace(CLOSE_PAREN_RE, "");
  return true;
};
