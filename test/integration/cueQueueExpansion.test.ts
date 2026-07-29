/**
 * CUE 分轨队列展开集成测试
 *
 * 验证 Task 23：当用户从曲库点击播放一首含 CUE 的原始音频文件时，
 * 应将其展开为同 audioPath 的所有 cue:// 虚拟分轨再 setQueue。
 *
 * 覆盖：
 * - CUE 路径协议识别（isCueTrackPath）
 * - CUE 路径解析（extractCuePath / getCueAudioPath / toCueTrackPath）
 * - 集成展开函数 expandCueTracks 的核心场景
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCueTrackPath,
  getCueAudioPath,
  extractCuePath,
  toCueTrackPath,
} from "../../shared/utils/cuePath.js";
import { expandCueTracks } from "../../src/core/player/cueExpansion.js";
import type { Track } from "../../shared/types/player.js";

test("CUE 路径识别：cue:// 协议被识别", () => {
  assert.equal(isCueTrackPath("cue://D:/music/album.flac#0"), true);
  assert.equal(isCueTrackPath("D:/music/album.flac"), false);
  assert.equal(isCueTrackPath("cue://D:/music/album.flac#5"), true);
});

test("CUE 路径解析：提取 audioPath 和 index", () => {
  const parsed = extractCuePath("cue://D:/music/album.flac#3");
  assert.ok(parsed);
  assert.equal(parsed!.audioPath, "D:/music/album.flac");
  assert.equal(parsed!.index, 3);
});

test("CUE 路径解析：非 cue:// 协议返回 null", () => {
  assert.equal(extractCuePath("D:/music/album.flac"), null);
});

test("CUE 路径构建：toCueTrackPath 生成正确协议", () => {
  const path = toCueTrackPath("D:/music/album.flac", 2);
  assert.equal(path, "cue://D:/music/album.flac#2");
  assert.equal(isCueTrackPath(path), true);
});

test("CUE 路径反查：getCueAudioPath 提取原始音频路径", () => {
  assert.equal(
    getCueAudioPath("cue://D:/music/album.flac#1"),
    "D:/music/album.flac",
  );
  assert.equal(getCueAudioPath("D:/music/album.flac"), "D:/music/album.flac");
});

test("集成：展开函数应将原始音频替换为 cue:// 分轨", () => {
  // 模拟库中曲目：一首原始 flac + 两首 cue:// 虚拟分轨
  const libraryTracks = [
    { id: "raw1", path: "D:/music/album.flac", source: "local", title: "Album" },
    { id: "cue0", path: "cue://D:/music/album.flac#0", source: "local", title: "Track 1" },
    { id: "cue1", path: "cue://D:/music/album.flac#1", source: "local", title: "Track 2" },
  ] as unknown as Track[];

  // 用户选中原始 flac 播放
  const selected = [libraryTracks[0]];
  // 展开逻辑：如果选中曲目的 path 对应库中有 cue:// 分轨，则替换为分轨
  const expanded = expandCueTracks(selected, libraryTracks);
  assert.equal(expanded.length, 2);
  assert.ok(expanded.every((t) => isCueTrackPath(t.path ?? "")));
  assert.equal(expanded[0].id, "cue0");
  assert.equal(expanded[1].id, "cue1");
});

test("集成：无 CUE 分轨的曲目保持原样", () => {
  const libraryTracks = [
    { id: "raw1", path: "D:/music/standalone.flac", source: "local", title: "Standalone" },
  ] as unknown as Track[];
  const selected = [libraryTracks[0]];
  const expanded = expandCueTracks(selected, libraryTracks);
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].id, "raw1");
});

test("集成：已是 cue:// 的曲目不重复展开", () => {
  const libraryTracks = [
    { id: "cue0", path: "cue://D:/music/album.flac#0", source: "local", title: "Track 1" },
    { id: "cue1", path: "cue://D:/music/album.flac#1", source: "local", title: "Track 2" },
  ] as unknown as Track[];
  const selected = [libraryTracks[0]];
  const expanded = expandCueTracks(selected, libraryTracks);
  assert.equal(expanded.length, 1);
  assert.equal(expanded[0].id, "cue0");
});
