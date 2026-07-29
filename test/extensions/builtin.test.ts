import { test } from "node:test";
import assert from "node:assert/strict";
import { registerBuiltinExtensions } from "../../src/extensions/builtin/index.js";
import { ALL_REGISTRIES } from "../../shared/extensions/registries.js";

test("registerBuiltinExtensions 返回 Disposable", () => {
  const disposable = registerBuiltinExtensions();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后所有 12 个 Registry 仍可访问", () => {
  const disposable = registerBuiltinExtensions();
  // 阶段 3.0 只搭建骨架，暂不注册实际条目，但不应破坏 Registry 可访问性
  assert.equal(ALL_REGISTRIES.length, 12);
  for (const { name, registry } of ALL_REGISTRIES) {
    assert.ok(registry, `Registry ${name} 应可访问`);
  }
  disposable.dispose();
});

test("dispose 后 Registry 恢复空状态", () => {
  const disposable = registerBuiltinExtensions();
  disposable.dispose();
  for (const { registry } of ALL_REGISTRIES) {
    assert.equal(registry.resolve().length, 0, "dispose 后应清空");
  }
});

test("registerBuiltinExtensions 可重复调用", () => {
  const d1 = registerBuiltinExtensions();
  const d2 = registerBuiltinExtensions();
  d1.dispose();
  d2.dispose();
  // 两次注册两次清理，不应泄漏
  for (const { registry } of ALL_REGISTRIES) {
    assert.equal(registry.resolve().length, 0);
  }
});
