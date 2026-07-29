import { test } from "node:test";
import assert from "node:assert/strict";
import { registerLyricsEffects } from "../../src/extensions/builtin/lyricsEffect.js";
import { LyricsEffectRegistry } from "../../shared/extensions/registries.js";

test("registerLyricsEffects 返回 Disposable", () => {
  const disposable = registerLyricsEffects();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 LyricsEffect Registry 至少有 3 个 builtin 条目", () => {
  const disposable = registerLyricsEffects();
  const descriptors = LyricsEffectRegistry.listDescriptors();
  assert.ok(descriptors.length >= 3);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("条目 id 包含 fade/slide/scale", () => {
  const disposable = registerLyricsEffects();
  const ids = LyricsEffectRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.includes("fade"));
  assert.ok(ids.includes("slide"));
  assert.ok(ids.includes("scale"));
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerLyricsEffects();
  disposable.dispose();
  assert.equal(LyricsEffectRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 apply 函数", () => {
  const disposable = registerLyricsEffects();
  const impls = LyricsEffectRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.equal(typeof impl.apply, "function");
  }
  disposable.dispose();
});
