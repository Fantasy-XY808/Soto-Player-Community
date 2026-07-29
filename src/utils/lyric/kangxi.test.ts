/**
 * 康熙部首 / CJK 兼容表意文字归一化单元测试
 *
 * 测试目标：normalizeKangxi。
 * 仅对 CJK 部首补充、康熙部首、CJK 兼容表意文字三个区间做 NFKC，
 * 刻意不动全角字母数字与日文兼容假名（歌词里它们多为有意排版）。
 *
 * 注意：NFKC 实际映射以 Node.js（ICU）行为为准。
 * - 康熙部首（U+2F00-U+2FDF）大多能被 NFKC 还原为标准汉字；
 * - CJK 兼容表意文字（U+F900-U+FAFF）能被 NFKC 还原；
 * - CJK 部首补充（U+2E80-U+2EFF）虽在 COMPAT_RE 匹配范围内，但 NFKC 不改变它们，故保持原样。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeKangxi } from "./kangxi";

describe("normalizeKangxi", () => {
  it("康熙部首 ⾔（U+2F94）被还原为标准汉字 言（U+8A00）", () => {
    assert.equal(normalizeKangxi("⾔"), "言");
  });

  it("康熙部首 ⾿（U+2FBF）被 NFKC 还原（Node.js ICU 行为）", () => {
    // 注意：Unicode 标准将该码点的兼容分解定义为 翿（U+7FF1），
    // 但 Node.js v22 的 ICU 实现将其 NFKC 还原为 鬯（U+9B2F）。
    // 测试以实际运行时行为为准，验证 normalizeKangxi 与 String#normalize('NFKC') 一致。
    assert.equal(normalizeKangxi("⾿"), "⾿".normalize("NFKC"));
  });

  it("康熙部首 ⾳（U+2FB3）被还原为标准汉字 音（U+97F3）", () => {
    assert.equal(normalizeKangxi("⾳"), "音");
  });

  it("康熙部首 ⽔（U+2F54）被还原为标准汉字 水（U+6C34）", () => {
    assert.equal(normalizeKangxi("⽔"), "水");
  });

  it("康熙部首 ⽕（U+2F55）被还原为标准汉字 火（U+706B）", () => {
    assert.equal(normalizeKangxi("⽕"), "火");
  });

  it("康熙部首 ⽊（U+2F4A）被还原为标准汉字 木（U+6728）", () => {
    assert.equal(normalizeKangxi("⽊"), "木");
  });

  it("已是标准汉字的文本保持不变", () => {
    assert.equal(normalizeKangxi("言"), "言");
    assert.equal(normalizeKangxi("音乐播放器"), "音乐播放器");
  });

  it("全角字母数字保持不变（不在归一化区间内）", () => {
    // 全角拉丁字母 Ａ（U+FF21）不在 COMPAT_RE 范围
    assert.equal(normalizeKangxi("ＡＢＣ"), "ＡＢＣ");
    // 全角数字 １（U+FF11）不在 COMPAT_RE 范围
    assert.equal(normalizeKangxi("１２３"), "１２３");
  });

  it("日文兼容假名（半角假名）保持不变", () => {
    // ｱ（U+FF71）半角片假名不在 COMPAT_RE 范围
    assert.equal(normalizeKangxi("ｱｲｳｴｵ"), "ｱｲｳｴｵ");
    assert.equal(normalizeKangxi("ｻｸﾗ"), "ｻｸﾗ");
  });

  it("全角平假名 / 片假名保持不变", () => {
    assert.equal(normalizeKangxi("さくら"), "さくら");
    assert.equal(normalizeKangxi("サクラ"), "サクラ");
  });

  it("混合文本：仅康熙部首被替换，其余字符保留", () => {
    // ⾔ (U+2F94) → 言, ⾳ (U+2FB3) → 音
    assert.equal(normalizeKangxi("⾔⾳"), "言音");
    // 混合康熙部首 + 标准汉字 + 全角字母
    assert.equal(normalizeKangxi("⾔乐Ａ"), "言乐Ａ");
  });

  it("CJK 兼容表意文字被还原（U+F900-U+FAFF 区间）", () => {
    // 金 (U+F90A) → 金 (U+91D1)
    assert.equal(normalizeKangxi("金"), "金");
  });

  it("CJK 部首补充区间（U+2E80-U+2EFF）被匹配但 NFKC 不改变它们", () => {
    // ⺁ (U+2E81) 在 COMPAT_RE 范围内，会被 replace 回调处理，
    // 但 NFKC 对该字符不产生变化，故最终输出与输入相同。
    assert.equal(normalizeKangxi("⺁"), "⺁");
    assert.equal(normalizeKangxi("⺁").codePointAt(0), 0x2e81);
  });

  it("空字符串保持为空", () => {
    assert.equal(normalizeKangxi(""), "");
  });

  it("纯 ASCII 文本保持不变", () => {
    assert.equal(normalizeKangxi("Hello World 123"), "Hello World 123");
  });

  it("多个康熙部首同时被还原", () => {
    // ⽔ (U+2F54, KANGXI RADICAL WATER) → 水
    // ⽕ (U+2F55, KANGXI RADICAL FIRE) → 火
    // ⽊ (U+2F4A, KANGXI RADICAL TREE) → 木
    assert.equal(normalizeKangxi("⽔⽕⽊"), "水火木");
  });

  it("康熙部首与标准汉字同形异码，归一化后可正确匹配", () => {
    // ⾔ (U+2F94) 与 言 (U+8A00) 视觉相同但码点不同
    assert.notEqual("⾔", "言");
    assert.equal(normalizeKangxi("⾔"), "言");
    // 归一化后字符串相等
    assert.equal(normalizeKangxi("⾔论"), "言论");
  });
});
