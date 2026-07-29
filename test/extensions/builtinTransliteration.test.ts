import { test } from "node:test";
import assert from "node:assert/strict";
import { registerTransliterationProviders } from "../../src/extensions/builtin/transliteration.js";
import { TransliterationProviderRegistry } from "../../shared/extensions/registries.js";

test("registerTransliterationProviders 返回 Disposable", () => {
  const disposable = registerTransliterationProviders();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 TransliterationProvider Registry 有 builtin 条目（至少 1 个）", () => {
  const disposable = registerTransliterationProviders();
  const descriptors = TransliterationProviderRegistry.listDescriptors();
  assert.ok(descriptors.length >= 1);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("条目 id 包含 builtin 或 local（本地音译）", () => {
  const disposable = registerTransliterationProviders();
  const ids = TransliterationProviderRegistry.listDescriptors().map((d) => d.id);
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
  const disposable = registerTransliterationProviders();
  disposable.dispose();
  assert.equal(TransliterationProviderRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 transliterate 函数", () => {
  const disposable = registerTransliterationProviders();
  const impls = TransliterationProviderRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.equal(typeof impl.transliterate, "function");
  }
  disposable.dispose();
});
