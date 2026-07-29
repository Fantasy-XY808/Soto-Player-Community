import { test } from "node:test";
import assert from "node:assert/strict";
import { registerWindowModes } from "../../src/extensions/builtin/windowMode.js";
import { WindowModeRegistry } from "../../shared/extensions/registries.js";

test("registerWindowModes 返回 Disposable", () => {
  const disposable = registerWindowModes();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 WindowMode Registry 有 4 个 builtin 条目", () => {
  const disposable = registerWindowModes();
  const descriptors = WindowModeRegistry.listDescriptors();
  assert.equal(descriptors.length, 4);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("4 个条目 id 为 standard/desktop/taskbar/dynamicIsland", () => {
  const disposable = registerWindowModes();
  const ids = WindowModeRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.includes("standard"));
  assert.ok(ids.includes("desktop"));
  assert.ok(ids.includes("taskbar"));
  assert.ok(ids.includes("dynamicIsland"));
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerWindowModes();
  disposable.dispose();
  assert.equal(WindowModeRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 apply 函数", () => {
  const disposable = registerWindowModes();
  const impls = WindowModeRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.equal(typeof impl.apply, "function");
  }
  disposable.dispose();
});
