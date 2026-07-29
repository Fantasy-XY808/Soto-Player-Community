import { test } from "node:test";
import assert from "node:assert/strict";
import { registerLayoutProfiles } from "../../src/extensions/builtin/layoutProfile.js";
import { LayoutProfileRegistry } from "../../shared/extensions/registries.js";

test("registerLayoutProfiles 返回 Disposable", () => {
  const disposable = registerLayoutProfiles();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 LayoutProfile Registry 有 builtin 条目（至少 3 个）", () => {
  const disposable = registerLayoutProfiles();
  const descriptors = LayoutProfileRegistry.listDescriptors();
  assert.ok(descriptors.length >= 3);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("条目 id 包含 standard/stacked/cover-focused", () => {
  const disposable = registerLayoutProfiles();
  const ids = LayoutProfileRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.includes("standard"));
  assert.ok(ids.includes("stacked"));
  assert.ok(ids.includes("cover-focused"));
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerLayoutProfiles();
  disposable.dispose();
  assert.equal(LayoutProfileRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 rowDefinitions/columnDefinitions/placements 字段", () => {
  const disposable = registerLayoutProfiles();
  const impls = LayoutProfileRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.ok(Array.isArray(impl.rowDefinitions));
    assert.ok(Array.isArray(impl.columnDefinitions));
    assert.ok(Array.isArray(impl.placements));
    assert.equal(typeof impl.id, "string");
    assert.equal(typeof impl.name, "string");
    assert.equal(typeof impl.mode, "number");
  }
  disposable.dispose();
});
