/**
 * SRT 字幕格式解析器
 *
 * 格式：
 * ```
 * 序号
 * 起始时间 --> 结束时间
 * 文本行（1~3 行）
 * 空行分隔
 * ```
 *
 * 时间格式：HH:MM:SS,mmm（逗号或点号分隔毫秒）
 *
 * 文本行规则（从最后一行往上）：
 * - 1 行：原词
 * - 2 行：翻译 + 原词
 * - 3 行：音译 + 翻译 + 原词
 */

import type { LyricLine } from "@shared/types/lyrics";

/** 匹配 SRT 时间戳 HH:MM:SS,mmm */
const TIME_RE = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

/**
 * 解析 SRT 时间戳为毫秒
 * @param value 时间戳字符串，如 "00:01:23,456"
 */
const parseSrtTime = (value: string): number => {
  const m = TIME_RE.exec(value);
  if (!m) return 0;
  const hr = parseInt(m[1]);
  const min = parseInt(m[2]);
  const sec = parseInt(m[3]);
  let ms = parseInt(m[4]);
  // 归一化毫秒位数
  if (m[4].length === 1) ms *= 100;
  else if (m[4].length === 2) ms *= 10;
  return ((hr * 60 + min) * 60 + sec) * 1000 + ms;
};

/**
 * 解析 SRT 字幕文本
 * @param text SRT 文本内容
 * @returns 解析后的歌词行数组
 */
export const parseSRT = (text: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  // 按空行分割为 block
  const blocks = text.replace(/\r\n/g, "\n").split(/\n\n+/);

  for (const block of blocks) {
    const parts = block.trim().split("\n");
    // 至少需要：序号 + 时间行 + 文本行
    if (parts.length < 3) continue;

    // 第一行是序号
    if (!/^\d+$/.test(parts[0].trim())) continue;

    // 第二行是时间范围
    const timeLine = parts[1];
    const arrowIdx = timeLine.indexOf("-->");
    if (arrowIdx === -1) continue;

    const startTime = parseSrtTime(timeLine.slice(0, arrowIdx));
    const endTime = parseSrtTime(timeLine.slice(arrowIdx + 3));

    // 剩余行为文本内容
    const textLines = parts
      .slice(2)
      .filter((l) => l.trim())
      .map((l) => l.trim());
    if (textLines.length === 0) continue;

    // 最后一行是原词，往上依次是翻译、音译
    const count = textLines.length;
    const mainText = textLines[count - 1];
    const translatedLyric = count >= 2 ? textLines[count - 2] : "";
    const romanLyric = count >= 3 ? textLines[count - 3] : "";

    lines.push({
      words: [{ startTime, endTime, word: mainText }],
      translatedLyric,
      romanLyric,
      startTime,
      endTime,
      isBG: false,
      isDuet: false,
    });
  }

  return lines;
};
