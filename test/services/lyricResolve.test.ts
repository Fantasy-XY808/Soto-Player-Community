import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeLyricLines,
  mergeTranslations,
  mergeRomanization,
  pickBestLyricSource,
  type LyricSourceResult,
} from "../../electron/main/services/lyricResolve.js";
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

test("mergeLyricLines 按时间戳合并两份歌词", () => {
  const a = [makeLine(0, "a0"), makeLine(2000, "a2")];
  const b = [makeLine(1000, "b1"), makeLine(3000, "b3")];
  const merged = mergeLyricLines(a, b);
  assert.equal(merged.length, 4);
  assert.equal(merged[0].words[0].word, "a0");
  assert.equal(merged[1].words[0].word, "b1");
  assert.equal(merged[2].words[0].word, "a2");
  assert.equal(merged[3].words[0].word, "b3");
});

test("mergeTranslations 按时间戳匹配翻译", () => {
  const original = [makeLine(0, "hello"), makeLine(1000, "world")];
  const translation = [makeLine(0, "你好"), makeLine(1000, "世界")];
  const merged = mergeTranslations(original, translation);
  assert.equal(merged[0].translatedLyric, "你好");
  assert.equal(merged[1].translatedLyric, "世界");
});

test("mergeRomanization 按时间戳匹配罗马音", () => {
  const original = [makeLine(0, "hello")];
  const roman = [makeLine(0, "heruo")];
  const merged = mergeRomanization(original, roman);
  assert.equal(merged[0].romanLyric, "heruo");
});

test("pickBestLyricSource 选择行数最多且质量最高的源", () => {
  const sources: LyricSourceResult[] = [
    { sourceId: "a", lines: [makeLine(0, "x")], quality: 0.5 },
    { sourceId: "b", lines: [makeLine(0, "x"), makeLine(1000, "y")], quality: 0.8 },
    { sourceId: "c", lines: [makeLine(0, "x"), makeLine(1000, "y")], quality: 0.6 },
  ];
  const best = pickBestLyricSource(sources);
  assert.equal(best?.sourceId, "b");
});

test("pickBestLyricSource 空数组返回 null", () => {
  assert.equal(pickBestLyricSource([]), null);
});
