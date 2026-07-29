/**
 * CUE sheet 解析器单元测试
 *
 * 参考 dr-190 fork 的 cue.test.ts 风格，使用 node:test + node:assert/strict。
 * 测试目标：parseCueSheet（track 解析、时间戳转换、UTF-8 BOM 处理）+ toCueTrackInfos。
 *
 * 注意：Soto_Player 的 cue.ts 与 dr-190 fork 的实现签名不同——
 * - Soto_Player 返回 CueSheet（含 cueDir/audioPath/audioType/tracks），tracks 元素为 CueTrack（秒级时间）；
 * - dr-190 fork 返回 track 数组（毫秒级时间 + artists/album 对象）。
 * 测试用例按 Soto_Player 实际实现编写。
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseCueSheet, toCueTrackInfos } from "./cue";

const sample = `
REM GENRE Classical
PERFORMER "Serge Prokofiev"
TITLE "Archive Recordings"
FILE "Serge Prokofiev - Archive Recordings.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Piano Sonata No. 3 in A Minor, Op. 28"
    PERFORMER "Serge Prokofiev"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Piano Sonata No. 7 in B-Flat Major, Op. 83: I. Allegro inquieto"
    INDEX 01 07:14:18
  TRACK 03 AUDIO
    TITLE "Piano Sonata No. 7 in B-Flat Major, Op. 83: II. Andante caloroso"
    INDEX 01 15:41:12
`;

describe("parseCueSheet", () => {
  it("解析单文件 CUE 并生成分轨时间（秒，75 帧/秒）", () => {
    const sheet = parseCueSheet(sample, "C:/Music/Archive Recordings.cue");

    assert.equal(sheet.tracks.length, 3);

    // 第一轨
    assert.equal(sheet.tracks[0].index, 0);
    assert.equal(sheet.tracks[0].trackNumber, 1);
    assert.equal(sheet.tracks[0].title, "Piano Sonata No. 3 in A Minor, Op. 28");
    assert.equal(sheet.tracks[0].artist, "Serge Prokofiev");
    assert.equal(sheet.tracks[0].album, "Archive Recordings");
    assert.equal(sheet.tracks[0].startTimeSec, 0);
    // 07:14:18 → 7*60 + 14 + 18/75 = 434.24
    assert.equal(sheet.tracks[0].endTimeSec, 434.24);

    // 第二轨
    assert.equal(sheet.tracks[1].index, 1);
    assert.equal(sheet.tracks[1].trackNumber, 2);
    assert.equal(sheet.tracks[1].startTimeSec, 434.24);
    // 15:41:12 → 15*60 + 41 + 12/75 = 941.16
    assert.equal(sheet.tracks[1].endTimeSec, 941.16);

    // 最后一轨 endTimeSec 为 null（到文件结束）
    assert.equal(sheet.tracks[2].index, 2);
    assert.equal(sheet.tracks[2].trackNumber, 3);
    assert.equal(sheet.tracks[2].startTimeSec, 941.16);
    assert.equal(sheet.tracks[2].endTimeSec, null);
  });

  it("audioPath 由 FILE 行 + cuePath 推导，保留原分隔符风格", () => {
    const sheet = parseCueSheet(sample, "C:/Music/Archive Recordings.cue");
    assert.equal(
      sheet.audioPath,
      "C:/Music/Serge Prokofiev - Archive Recordings.flac",
    );
    assert.equal(sheet.audioType, "WAVE");
  });

  it("cueDir 为 cuePath 的目录部分（去除末尾分隔符）", () => {
    const sheet = parseCueSheet(sample, "C:/Music/Archive Recordings.cue");
    assert.equal(sheet.cueDir, "C:/Music");
  });

  it("全局 TITLE 与 PERFORMER 被解析为 album / albumPerformer", () => {
    const sheet = parseCueSheet(sample, "C:/Music/Archive Recordings.cue");
    assert.equal(sheet.tracks[0].album, "Archive Recordings");
    // 第一轨显式声明了 PERFORMER，应保留
    assert.equal(sheet.tracks[0].artist, "Serge Prokofiev");
    // 第二轨未显式声明 PERFORMER，应回退到全局 albumPerformer
    assert.equal(sheet.tracks[1].artist, "Serge Prokofiev");
  });

  it("UTF-8 BOM 不影响解析（首行 BOM 被 trim 移除）", () => {
    const bomSample = `\uFEFF${sample.trimStart()}`;
    const sheet = parseCueSheet(bomSample, "C:/Music/Archive Recordings.cue");
    assert.equal(sheet.tracks.length, 3);
    assert.equal(sheet.tracks[0].title, "Piano Sonata No. 3 in A Minor, Op. 28");
  });

  it("\\r\\n 换行被正确处理", () => {
    const crlfSample = sample.replace(/\n/g, "\r\n");
    const sheet = parseCueSheet(crlfSample, "C:/Music/Archive Recordings.cue");
    assert.equal(sheet.tracks.length, 3);
    assert.equal(sheet.tracks[1].title, "Piano Sonata No. 7 in B-Flat Major, Op. 83: I. Allegro inquieto");
  });

  it("时间戳 MM:SS:FF 转换：00:00:00 → 0 秒", () => {
    const sheet = parseCueSheet(
      `FILE "a.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:00\n`,
      "C:/a.cue",
    );
    assert.equal(sheet.tracks[0].startTimeSec, 0);
  });

  it("时间戳 MM:SS:FF 转换：01:00:00 → 60 秒（1 分钟）", () => {
    const sheet = parseCueSheet(
      `FILE "a.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 01:00:00\n`,
      "C:/a.cue",
    );
    assert.equal(sheet.tracks[0].startTimeSec, 60);
  });

  it("时间戳 MM:SS:FF 转换：00:00:74 → 74/75 秒（不足 1 秒）", () => {
    const sheet = parseCueSheet(
      `FILE "a.flac" WAVE\n  TRACK 01 AUDIO\n    INDEX 01 00:00:74\n`,
      "C:/a.cue",
    );
    assert.equal(sheet.tracks[0].startTimeSec, 74 / 75);
  });

  it("空文本不抛错，tracks 为空", () => {
    const sheet = parseCueSheet("", "C:/empty.cue");
    assert.equal(sheet.tracks.length, 0);
    assert.equal(sheet.audioPath, "");
    assert.equal(sheet.audioType, "");
  });

  it("仅含 FILE 行无 TRACK 时 tracks 为空但 audioPath 被填充", () => {
    const sheet = parseCueSheet(
      `FILE "lonely.flac" WAVE\n`,
      "C:/Music/lonely.cue",
    );
    assert.equal(sheet.tracks.length, 0);
    assert.equal(sheet.audioPath, "C:/Music/lonely.flac");
    assert.equal(sheet.audioType, "WAVE");
  });

  it("Windows 反斜杠路径被正确处理", () => {
    const sheet = parseCueSheet(sample, "C:\\Music\\Archive Recordings.cue");
    assert.equal(sheet.cueDir, "C:\\Music");
    assert.equal(
      sheet.audioPath,
      "C:\\Music\\Serge Prokofiev - Archive Recordings.flac",
    );
  });

  it("多个 FILE 行只取首个 audioPath，但 TRACK 仍被继续解析", () => {
    const multi = `
FILE "first.flac" WAVE
  TRACK 01 AUDIO
    INDEX 01 00:00:00
FILE "second.flac" WAVE
  TRACK 02 AUDIO
    INDEX 01 01:00:00
`;
    const sheet = parseCueSheet(multi, "C:/m.cue");
    // audioPath 只取首个 FILE
    assert.equal(sheet.audioPath, "C:/first.flac");
    // 但 TRACK 解析不依赖 FILE 守卫，第二轨仍被解析
    assert.equal(sheet.tracks.length, 2);
    assert.equal(sheet.tracks[1].trackNumber, 2);
    // 01:00:00 → 1*60 + 0 + 0/75 = 60 秒
    assert.equal(sheet.tracks[1].startTimeSec, 60);
  });
});

describe("toCueTrackInfos", () => {
  it("将 CueSheet 转换为 CueTrackInfo[]（毫秒级时间 + cue:// 协议路径）", () => {
    const sheet = parseCueSheet(sample, "C:/Music/Archive Recordings.cue");
    const infos = toCueTrackInfos(sheet);

    assert.equal(infos.length, 3);

    // 第一轨
    assert.equal(infos[0].path, "cue://C:/Music/Serge Prokofiev - Archive Recordings.flac#0");
    assert.equal(infos[0].audioPath, "C:/Music/Serge Prokofiev - Archive Recordings.flac");
    assert.equal(infos[0].cueIndex, 0);
    assert.equal(infos[0].title, "Piano Sonata No. 3 in A Minor, Op. 28");
    assert.equal(infos[0].artist, "Serge Prokofiev");
    assert.equal(infos[0].album, "Archive Recordings");
    assert.equal(infos[0].startTimeMs, 0);
    assert.equal(infos[0].endTimeMs, 434_240);
    assert.equal(infos[0].durationMs, 434_240);

    // 第二轨
    assert.equal(infos[1].startTimeMs, 434_240);
    assert.equal(infos[1].endTimeMs, 941_160);
    assert.equal(infos[1].durationMs, 941_160 - 434_240);

    // 最后一轨 endTimeMs 与 durationMs 为 null
    assert.equal(infos[2].startTimeMs, 941_160);
    assert.equal(infos[2].endTimeMs, null);
    assert.equal(infos[2].durationMs, null);
  });

  it("空 CueSheet 转换为空数组", () => {
    const sheet = parseCueSheet("", "C:/empty.cue");
    const infos = toCueTrackInfos(sheet);
    assert.equal(infos.length, 0);
  });
});
