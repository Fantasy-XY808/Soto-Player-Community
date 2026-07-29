import { test } from "node:test";
import assert from "node:assert/strict";
import { registerMusicSources } from "../../src/extensions/builtin/musicSource.js";
import { MusicSourceRegistry } from "../../shared/extensions/registries.js";

test("registerMusicSources 返回 Disposable", () => {
  const disposable = registerMusicSources();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 MusicSource Registry 有 3 个 builtin 条目", () => {
  const disposable = registerMusicSources();
  const descriptors = MusicSourceRegistry.listDescriptors();
  assert.equal(descriptors.length, 3);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("3 个条目 id 为 netease/qqmusic/kugou", () => {
  const disposable = registerMusicSources();
  const ids = MusicSourceRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.includes("netease"));
  assert.ok(ids.includes("qqmusic"));
  assert.ok(ids.includes("kugou"));
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerMusicSources();
  disposable.dispose();
  assert.equal(MusicSourceRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 search 和 resolveUrl 函数", () => {
  const disposable = registerMusicSources();
  const impls = MusicSourceRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.equal(typeof impl.search, "function");
    assert.equal(typeof impl.resolveUrl, "function");
  }
  disposable.dispose();
});
