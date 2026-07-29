import { test } from "node:test";
import assert from "node:assert/strict";
import { toCueTrackPath, extractCuePath, getCueAudioPath } from "../../shared/utils/cuePath";

test("toCueTrackPath 编码音频路径与索引", () => {
  assert.equal(
    toCueTrackPath("/music/album.flac", 2),
    "cue:///music/album.flac#2",
  );
});

test("extractCuePath 从 cue:// 路径提取音频路径与索引", () => {
  const r = extractCuePath("cue:///music/album.flac#2");
  assert.equal(r.audioPath, "/music/album.flac");
  assert.equal(r.index, 2);
});

test("extractCuePath 对非 cue:// 路径返回 null", () => {
  assert.equal(extractCuePath("/music/album.flac"), null);
});

test("getCueAudioPath 提取纯音频路径", () => {
  assert.equal(getCueAudioPath("cue:///music/album.flac#2"), "/music/album.flac");
  assert.equal(getCueAudioPath("/music/album.flac"), "/music/album.flac");
});
