import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCueSheet } from "../../electron/main/services/cue.js";

const SAMPLE_CUE = `REM GENRE "Pop"
TITLE "Test Album"
PERFORMER "Test Artist"
FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "First Song"
    PERFORMER "Artist A"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "Second Song"
    PERFORMER "Artist B"
    INDEX 01 03:30:00
  TRACK 03 AUDIO
    TITLE "Last Song"
    INDEX 01 07:15:00
`;

test("parseCueSheet 解析 CUE 文本", () => {
  const sheet = parseCueSheet(SAMPLE_CUE, "/music/album.cue");
  assert.equal(sheet.cueDir, "/music");
  assert.equal(sheet.audioPath, "/music/album.flac");
  assert.equal(sheet.audioType, "WAVE");
  assert.equal(sheet.tracks.length, 3);
});

test("parseCueSheet 解析曲目标题与索引", () => {
  const sheet = parseCueSheet(SAMPLE_CUE, "/music/album.cue");
  assert.equal(sheet.tracks[0].title, "First Song");
  assert.equal(sheet.tracks[0].trackNumber, 1);
  assert.equal(sheet.tracks[1].title, "Second Song");
});

test("parseCueSheet 时间换算 MM:SS:FF → 秒（75 帧/秒）", () => {
  const sheet = parseCueSheet(SAMPLE_CUE, "/music/album.cue");
  // 00:00:00 = 0s
  assert.equal(sheet.tracks[0].startTimeSec, 0);
  // 03:30:00 = 210s
  assert.equal(sheet.tracks[1].startTimeSec, 210);
  // 07:15:00 = 435s
  assert.equal(sheet.tracks[2].startTimeSec, 435);
});

test("parseCueSheet 最后一曲 endTimeSec 为 null", () => {
  const sheet = parseCueSheet(SAMPLE_CUE, "/music/album.cue");
  assert.equal(sheet.tracks[0].endTimeSec, 210);
  assert.equal(sheet.tracks[1].endTimeSec, 435);
  assert.equal(sheet.tracks[2].endTimeSec, null);
});

test("parseCueSheet 处理 Windows 路径反斜杠", () => {
  const winCue = `FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "Song"
    INDEX 01 00:00:00
`;
  const sheet = parseCueSheet(winCue, "C:\\\\music\\\\album.cue");
  assert.equal(sheet.cueDir, "C:\\\\music");
  assert.equal(sheet.audioPath, "C:\\\\music\\\\album.flac");
});
