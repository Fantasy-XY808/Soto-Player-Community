import { test } from "node:test";
import assert from "node:assert/strict";
import { toCueTrackInfos, parseCueSheet } from "../../electron/main/services/cue.js";
import { extractCuePath } from "../../shared/utils/cuePath.js";

test("CUE 集成：parse → toCueTrackInfos → 路径协议可往返", () => {
  const text = `FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "A"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "B"
    INDEX 01 02:00:00
`;
  const sheet = parseCueSheet(text, "/m/album.cue");
  const infos = toCueTrackInfos(sheet);
  assert.equal(infos.length, 2);
  assert.equal(infos[0].path, "cue:///m/album.flac#0");
  assert.equal(infos[1].path, "cue:///m/album.flac#1");

  const r = extractCuePath(infos[1].path)!;
  assert.equal(r.audioPath, "/m/album.flac");
  assert.equal(r.index, 1);
});

test("CUE 集成：toCueTrackInfos 计算 durationMs 正确", () => {
  const text = `FILE "album.flac" WAVE
  TRACK 01 AUDIO
    TITLE "A"
    INDEX 01 00:00:00
  TRACK 02 AUDIO
    TITLE "B"
    INDEX 01 02:00:00
  TRACK 03 AUDIO
    TITLE "C"
    INDEX 01 05:00:00
`;
  const sheet = parseCueSheet(text, "/m/album.cue");
  const infos = toCueTrackInfos(sheet);
  // 第一曲 0s ~ 120s = 120000ms
  assert.equal(infos[0].durationMs, 120000);
  // 第二曲 120s ~ 300s = 180000ms
  assert.equal(infos[1].durationMs, 180000);
  // 最后一曲 endTimeMs 为 null，durationMs 为 null
  assert.equal(infos[2].endTimeMs, null);
  assert.equal(infos[2].durationMs, null);
});
