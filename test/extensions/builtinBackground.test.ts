import { test } from "node:test";
import assert from "node:assert/strict";
import { registerBackgroundOverlays } from "../../src/extensions/builtin/background.js";
import { BackgroundOverlayRegistry } from "../../shared/extensions/registries.js";

test("registerBackgroundOverlays 返回 Disposable", () => {
  const disposable = registerBackgroundOverlays();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 BackgroundOverlay Registry 有 3 个 builtin 条目", () => {
  const disposable = registerBackgroundOverlays();
  const descriptors = BackgroundOverlayRegistry.listDescriptors();
  assert.equal(descriptors.length, 3);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("3 个条目 id 为 fog/snow/raindrop", () => {
  const disposable = registerBackgroundOverlays();
  const ids = BackgroundOverlayRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.includes("fog"));
  assert.ok(ids.includes("snow"));
  assert.ok(ids.includes("raindrop"));
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerBackgroundOverlays();
  disposable.dispose();
  assert.equal(BackgroundOverlayRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 create 函数", () => {
  const disposable = registerBackgroundOverlays();
  const impls = BackgroundOverlayRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.equal(typeof impl.create, "function");
  }
  disposable.dispose();
});
