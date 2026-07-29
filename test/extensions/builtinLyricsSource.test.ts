import { test } from "node:test";
import assert from "node:assert/strict";
import { registerLyricsSources } from "../../src/extensions/builtin/lyricsSource.js";
import { LyricsSourceRegistry } from "../../shared/extensions/registries.js";

test("registerLyricsSources 返回 Disposable", () => {
  const disposable = registerLyricsSources();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 LyricsSource Registry 有 2 个 builtin 条目", () => {
  const disposable = registerLyricsSources();
  const descriptors = LyricsSourceRegistry.listDescriptors();
  assert.equal(descriptors.length, 2);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("2 个条目 id 为 netease/qqmusic", () => {
  const disposable = registerLyricsSources();
  const ids = LyricsSourceRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.includes("netease"));
  assert.ok(ids.includes("qqmusic"));
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerLyricsSources();
  disposable.dispose();
  assert.equal(LyricsSourceRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 search 函数", () => {
  const disposable = registerLyricsSources();
  const impls = LyricsSourceRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.equal(typeof impl.search, "function");
  }
  disposable.dispose();
});
