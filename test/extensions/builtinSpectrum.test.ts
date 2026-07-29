import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSpectrumStyles } from "../../src/extensions/builtin/spectrum.js";
import { SpectrumStyleRegistry } from "../../shared/extensions/registries.js";

test("registerSpectrumStyles 返回 Disposable", () => {
  const disposable = registerSpectrumStyles();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 SpectrumStyle Registry 有 3 个 builtin 条目", () => {
  const disposable = registerSpectrumStyles();
  const descriptors = SpectrumStyleRegistry.listDescriptors();
  assert.equal(descriptors.length, 3);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("3 个条目 id 为 bottom-bars/bottom-curve/around-radial", () => {
  const disposable = registerSpectrumStyles();
  const ids = SpectrumStyleRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.includes("bottom-bars"));
  assert.ok(ids.includes("bottom-curve"));
  assert.ok(ids.includes("around-radial"));
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerSpectrumStyles();
  disposable.dispose();
  assert.equal(SpectrumStyleRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 render 函数", () => {
  const disposable = registerSpectrumStyles();
  const impls = SpectrumStyleRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.equal(typeof impl.render, "function");
  }
  disposable.dispose();
});
