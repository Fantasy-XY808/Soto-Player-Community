import { test } from "node:test";
import assert from "node:assert/strict";
import { registerLyricsCardStyles } from "../../src/extensions/builtin/lyricsCard.js";
import { LyricsCardStyleRegistry } from "../../shared/extensions/registries.js";

test("registerLyricsCardStyles 返回 Disposable", () => {
  const disposable = registerLyricsCardStyles();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 LyricsCardStyle Registry 有 4 个 builtin 条目", () => {
  const disposable = registerLyricsCardStyles();
  const descriptors = LyricsCardStyleRegistry.listDescriptors();
  assert.equal(descriptors.length, 4);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("4 个条目 id 为 classic/compact/poster/minimal", () => {
  const disposable = registerLyricsCardStyles();
  const ids = LyricsCardStyleRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.includes("classic"));
  assert.ok(ids.includes("compact"));
  assert.ok(ids.includes("poster"));
  assert.ok(ids.includes("minimal"));
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerLyricsCardStyles();
  disposable.dispose();
  assert.equal(LyricsCardStyleRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 render 函数", () => {
  const disposable = registerLyricsCardStyles();
  const impls = LyricsCardStyleRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.equal(typeof impl.render, "function");
  }
  disposable.dispose();
});
