import type { LyricLine } from "@shared/types/lyrics";

/** 判断歌词是否为空（无行或所有行文本为空） */
export const isLyricEmpty = (lines: LyricLine[]): boolean => {
  if (lines.length === 0) return true;
  return lines.every((line) => {
    const text = line.words.map((w) => w.word).join("").trim();
    return text.length === 0;
  });
};

/** 返回当前播放进度 0-1 */
export const getLyricProgress = (lines: LyricLine[], positionMs: number): number => {
  if (lines.length === 0) return 0;
  const first = lines[0].startTime;
  const last = lines[lines.length - 1].startTime;
  if (last === first) return 1;
  const progress = (positionMs - first) / (last - first);
  return Math.max(0, Math.min(1, progress));
};

/** 二分查找当前激活行索引，无歌词返回 -1 */
export const findActiveLineIndex = (lines: LyricLine[], positionMs: number): number => {
  if (lines.length === 0) return -1;
  if (positionMs < lines[0].startTime) return 0;
  if (positionMs >= lines[lines.length - 1].startTime) return lines.length - 1;

  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (lines[mid].startTime <= positionMs) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
};

/** 格式化毫秒为 mm:ss */
export const formatLyricTime = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/** LRC 时间戳正则 [mm:ss.xx] */
const LRC_TIMESTAMP = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** LRC 任意方括号标签（含时间戳与元数据如 [ti:...]、[ar:...]） */
const LRC_ANY_TAG = /\[[^\]]*\]/g;

/** 拆分 LRC 文本为 LyricLine 数组 */
export const splitLyricLines = (text: string): LyricLine[] => {
  const lines: LyricLine[] = [];
  const rawLines = text.split(/\r?\n/);

  for (const raw of rawLines) {
    const matches = [...raw.matchAll(LRC_TIMESTAMP)];
    if (matches.length === 0) continue;

    const content = raw.replace(LRC_TIMESTAMP, "").trim();
    for (const match of matches) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const fracStr = match[3] ?? "0";
      const frac = parseInt(fracStr, 10) / Math.pow(10, fracStr.length);
      const time = (min * 60 + sec + frac) * 1000;

      lines.push({
        words: [{ startTime: time, endTime: time, word: content }],
        translatedLyric: "",
        romanLyric: "",
        startTime: time,
        endTime: time,
        isBG: false,
        isDuet: false,
      });
    }
  }

  return lines.sort((a, b) => a.startTime - b.startTime);
};

/** 移除 LRC 内联标签 */
export const stripLyricTags = (text: string): string => {
  return text.replace(LRC_ANY_TAG, " ").replace(/\s+/g, " ").trim();
};
