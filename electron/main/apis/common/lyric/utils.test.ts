import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitArtists,
  normalizeTrackArtists,
  buildLyricSearchKeyword,
  artistMatches,
} from "./utils.js";

test("splitArtists 拆分多歌手字符串", () => {
  assert.deepEqual(splitArtists("Alice / Bob"), ["Alice", "Bob"]);
  assert.deepEqual(splitArtists("Alice、Bob、Charlie"), ["Alice", "Bob", "Charlie"]);
  assert.deepEqual(splitArtists("Alice;Bob"), ["Alice", "Bob"]);
  assert.deepEqual(splitArtists("Alice"), ["Alice"]);
  assert.deepEqual(splitArtists(""), []);
});

test("normalizeTrackArtists 返回字符串", () => {
  assert.equal(normalizeTrackArtists("Alice / Bob"), "Alice Bob");
  assert.equal(normalizeTrackArtists("Alice、Bob"), "Alice Bob");
});

test("buildLyricSearchKeyword 拼接标题与歌手", () => {
  assert.equal(
    buildLyricSearchKeyword({ title: "Song", artist: "Alice" }),
    "Song Alice",
  );
  assert.equal(
    buildLyricSearchKeyword({ title: "Song", artist: "" }),
    "Song",
  );
  assert.equal(
    buildLyricSearchKeyword({ title: "Song", artist: "Alice", album: "Album" }),
    "Song Alice Album",
  );
});

test("artistMatches 模糊匹配歌手", () => {
  assert.ok(artistMatches("Alice", "Alice"));
  assert.ok(artistMatches("Alice & Bob", "Alice"));
  assert.ok(artistMatches("Alice、Bob", "Bob"));
  assert.ok(!artistMatches("Alice", "Bob"));
  assert.ok(!artistMatches("", "Bob"));
});
