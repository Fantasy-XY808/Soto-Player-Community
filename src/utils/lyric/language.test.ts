/**
 * 歌词语言检测单元测试
 *
 * 测试目标：applyLyricLanguages（按整首歌词上下文为每行打 LyricLanguage 标签）。
 *
 * 注意：Soto_Player 实际导出函数为 applyLyricLanguages（原地修改 lines[i].language），
 * 而非 detectLyricLanguage。测试用例按实际实现编写。
 *
 * 判定规则：
 * - 含假名（平假名/片假名/半角假名/长音符号）→ "ja"
 * - 含谚文（音节/字母/兼容字母）→ "ko"
 * - 含汉字 → 取决于整首歌词：出现假名→"ja"，否则出现谚文→"ko"，否则→"zh-CN"
 * - 含拉丁字母（无 CJK）→ "und-Latn"
 * - 以上都不匹配 → 移除 language 字段
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { applyLyricLanguages } from "./language";
import type { LyricLine } from "@shared/types/lyrics";

/** 构造一行歌词（words 拼接为 content） */
const makeLine = (text: string, startTime = 0): LyricLine => ({
  words: [{ startTime, endTime: startTime + 1000, word: text }],
  translatedLyric: "",
  romanLyric: "",
  startTime,
  endTime: startTime + 1000,
  isBG: false,
  isDuet: false,
});

describe("applyLyricLanguages", () => {
  it("纯中文行被标记为 zh-CN", () => {
    const lines = [makeLine("月亮代表我的心")];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "zh-CN");
  });

  it("含假名（平假名）的行被标记为 ja", () => {
    const lines = [makeLine("さくらが咲く")];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "ja");
  });

  it("含假名（片假名）的行被标记为 ja", () => {
    const lines = [makeLine("サクラが咲く")];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "ja");
  });

  it("含半角假名的行被标记为 ja", () => {
    const lines = [makeLine("ｻｸﾗが咲く")];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "ja");
  });

  it("含长音符号（ー）的行被标记为 ja", () => {
    const lines = [makeLine("スーパー")];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "ja");
  });

  it("含谚文音节的行被标记为 ko", () => {
    const lines = [makeLine("벚꽃이 피다")];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "ko");
  });

  it("含谚文兼容字母（ㄱㄴㄷ）的行被标记为 ko", () => {
    const lines = [makeLine("ㄱㄴㄷㄹ")];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "ko");
  });

  it("纯拉丁文行被标记为 und-Latn", () => {
    const lines = [makeLine("Hello World")];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "und-Latn");
  });

  it("纯数字/标点行（无任何脚本特征）language 被移除", () => {
    const lines = [makeLine("12345 !!!")];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, undefined);
  });

  it("混合整首：含假名时，纯汉字行也被标记为 ja", () => {
    const lines = [
      makeLine("さくらが咲く", 0), // 假名行
      makeLine("樱花开了", 1000), // 纯汉字行
    ];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "ja");
    // 整首出现假名，纯汉字行也视为日语
    assert.equal(lines[1].language, "ja");
  });

  it("混合整首：含谚文但无假名时，纯汉字行被标记为 ko", () => {
    const lines = [
      makeLine("벚꽃이 피다", 0), // 谚文行
      makeLine("樱花开了", 1000), // 纯汉字行
    ];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "ko");
    assert.equal(lines[1].language, "ko");
  });

  it("混合整首：无假名无谚文时，纯汉字行被标记为 zh-CN", () => {
    const lines = [
      makeLine("月亮代表我的心", 0),
      makeLine("你问我爱你有多深", 1000),
    ];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "zh-CN");
    assert.equal(lines[1].language, "zh-CN");
  });

  it("混合拉丁与中文：汉字行 zh-CN，拉丁行 und-Latn", () => {
    const lines = [
      makeLine("月亮代表我的心", 0),
      makeLine("Moon represents my heart", 1000),
    ];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "zh-CN");
    assert.equal(lines[1].language, "und-Latn");
  });

  it("空行数组不抛错", () => {
    const lines: LyricLine[] = [];
    applyLyricLanguages(lines);
    assert.equal(lines.length, 0);
  });

  it("已存在的 language 字段会被覆盖", () => {
    const lines = [makeLine("月亮代表我的心")];
    lines[0].language = "und-Latn";
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "zh-CN");
  });

  it("无脚本特征的行，原 language 字段被 delete（变为 undefined）", () => {
    const lines = [makeLine("12345")];
    lines[0].language = "zh-CN";
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, undefined);
  });

  it("多个 words 拼接后判定语言", () => {
    const lines: LyricLine[] = [
      {
        words: [
          { startTime: 0, endTime: 500, word: "さくら" },
          { startTime: 500, endTime: 1000, word: "が咲く" },
        ],
        translatedLyric: "",
        romanLyric: "",
        startTime: 0,
        endTime: 1000,
        isBG: false,
        isDuet: false,
      },
    ];
    applyLyricLanguages(lines);
    assert.equal(lines[0].language, "ja");
  });
});
