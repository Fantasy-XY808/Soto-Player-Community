import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCoverCacheKey,
  resolveCoverPath,
  isCoverCached,
  type CoverCacheEntry,
} from "../../electron/main/services/coverLoader.js";

test("buildCoverCacheKey 基于来源与 ID 生成稳定 key", () => {
  const key1 = buildCoverCacheKey("netease", "12345");
  const key2 = buildCoverCacheKey("netease", "12345");
  const key3 = buildCoverCacheKey("qqmusic", "12345");
  assert.equal(key1, key2);
  assert.notEqual(key1, key3);
  assert.ok(key1.startsWith("cover:"));
});

test("buildCoverCacheKey 对空输入返回 fallback", () => {
  const key = buildCoverCacheKey("", "");
  assert.ok(key.length > 0);
});

test("resolveCoverPath 本地文件路径直接返回", () => {
  const path = resolveCoverPath("/music/cover.jpg", "/cache");
  assert.equal(path, "/music/cover.jpg");
});

test("resolveCoverPath http URL 返回缓存路径", () => {
  const path = resolveCoverPath("https://p1.music.126.net/abc.jpg", "/cache");
  const normalized = path.replace(/\\/g, "/");
  assert.ok(normalized.startsWith("/cache"));
  assert.ok(normalized.endsWith(".jpg"));
});

test("CoverCacheEntry 接口字段完整", () => {
  const entry: CoverCacheEntry = {
    key: "cover:netease:12345",
    path: "/cache/cover_netease_12345.jpg",
    source: "netease",
    sourceId: "12345",
    createdAt: Date.now(),
    size: 1024,
  };
  assert.equal(entry.key, "cover:netease:12345");
});

test("isCoverCached 基于条目存在判断", () => {
  const cache = new Map<string, CoverCacheEntry>();
  cache.set("cover:netease:12345", {
    key: "cover:netease:12345",
    path: "/cache/x.jpg",
    source: "netease",
    sourceId: "12345",
    createdAt: 0,
    size: 0,
  });
  assert.equal(isCoverCached(cache, "cover:netease:12345"), true);
  assert.equal(isCoverCached(cache, "cover:netease:99999"), false);
});
