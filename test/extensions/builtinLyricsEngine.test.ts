import { test } from "node:test";
import assert from "node:assert/strict";
import { registerLyricsEngines } from "../../src/extensions/builtin/lyricsEngine.js";
import { LyricsEngineRegistry } from "../../shared/extensions/registries.js";

test("registerLyricsEngines 返回 Disposable", () => {
  const disposable = registerLyricsEngines();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 LyricsEngine Registry 至少有 2 个 builtin 条目", () => {
  const disposable = registerLyricsEngines();
  const descriptors = LyricsEngineRegistry.listDescriptors();
  assert.ok(descriptors.length >= 2);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("条目 id 包含 dom 和 canvas", () => {
  const disposable = registerLyricsEngines();
  const ids = LyricsEngineRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.includes("dom"), "应包含 dom 引擎");
  assert.ok(ids.includes("canvas"), "应包含 canvas 引擎");
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerLyricsEngines();
  disposable.dispose();
  assert.equal(LyricsEngineRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 create 函数", () => {
  const disposable = registerLyricsEngines();
  const impls = LyricsEngineRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.equal(typeof impl.create, "function");
  }
  disposable.dispose();
});
