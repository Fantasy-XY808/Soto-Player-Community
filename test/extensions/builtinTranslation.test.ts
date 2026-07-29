import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTranslationProviders } from "../../src/extensions/builtin/translation.js";
import { TranslationProviderRegistry } from "../../shared/extensions/registries.js";

test("registerTranslationProviders 返回 Disposable", () => {
  const disposable = registerTranslationProviders();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 TranslationProvider Registry 有 builtin 条目（至少 1 个）", () => {
  const disposable = registerTranslationProviders();
  const descriptors = TranslationProviderRegistry.listDescriptors();
  assert.ok(descriptors.length >= 1);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("条目 id 包含 builtin 或 local（本地词典翻译）", () => {
  const disposable = registerTranslationProviders();
  const ids = TranslationProviderRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.length >= 1);
  for (const id of ids) {
    assert.ok(
      id.includes("builtin") || id.includes("local"),
      `id "${id}" 应包含 builtin 或 local`,
    );
  }
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerTranslationProviders();
  disposable.dispose();
  assert.equal(TranslationProviderRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 translate 函数", () => {
  const disposable = registerTranslationProviders();
  const impls = TranslationProviderRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.equal(typeof impl.translate, "function");
  }
  disposable.dispose();
});
