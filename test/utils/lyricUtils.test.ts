import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isLyricEmpty,
  getLyricProgress,
  findActiveLineIndex,
  formatLyricTime,
  splitLyricLines,
  stripLyricTags,
} from "../../src/utils/lyricUtils.js";
import type { LyricLine } from "../../shared/types/lyrics.js";

const makeLine = (time: number, text: string): LyricLine => ({
  words: [{ startTime: time, endTime: time, word: text }],
  translatedLyric: "",
  romanLyric: "",
  startTime: time,
  endTime: time,
  isBG: false,
  isDuet: false,
});

test("isLyricEmpty 空歌词返回 true", () => {
  assert.equal(isLyricEmpty([]), true);
  assert.equal(isLyricEmpty([makeLine(0, "")]), true);
  assert.equal(isLyricEmpty([makeLine(1000, "hello")]), false);
});

test("getLyricProgress 返回 0-1 进度", () => {
  const lines = [makeLine(0, "a"), makeLine(1000, "b"), makeLine(2000, "c")];
  assert.equal(getLyricProgress(lines, 500), 0.25);
  assert.equal(getLyricProgress(lines, 1500), 0.75);
  assert.equal(getLyricProgress(lines, 3000), 1);
});

test("findActiveLineIndex 返回当前行索引", () => {
  const lines = [makeLine(0, "a"), makeLine(1000, "b"), makeLine(2000, "c")];
  assert.equal(findActiveLineIndex(lines, 0), 0);
  assert.equal(findActiveLineIndex(lines, 999), 0);
  assert.equal(findActiveLineIndex(lines, 1000), 1);
  assert.equal(findActiveLineIndex(lines, 1999), 1);
  assert.equal(findActiveLineIndex(lines, 2000), 2);
  assert.equal(findActiveLineIndex(lines, 5000), 2);
  assert.equal(findActiveLineIndex([], 100), -1);
});

test("formatLyricTime 格式化毫秒为 mm:ss", () => {
  assert.equal(formatLyricTime(0), "00:00");
  assert.equal(formatLyricTime(65000), "01:05");
  assert.equal(formatLyricTime(3723000), "62:03");
});

test("splitLyricLines 按时间戳拆分 LRC 文本", () => {
  const text = "[00:01.00]line1\n[00:03.50]line2\n[00:05.00]line3";
  const lines = splitLyricLines(text);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].startTime, 1000);
  assert.equal(lines[0].words[0].word, "line1");
  assert.equal(lines[1].startTime, 3500);
  assert.equal(lines[2].startTime, 5000);
});

test("stripLyricTags 移除 LRC 内联标签", () => {
  assert.equal(stripLyricTags("[00:01.00]hello [00:02.00]world"), "hello world");
  assert.equal(stripLyricTags("[ti:Song Title]"), "");
});
