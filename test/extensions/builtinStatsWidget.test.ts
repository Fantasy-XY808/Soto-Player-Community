import { test } from "node:test";
import assert from "node:assert/strict";
import { registerStatsWidgets } from "../../src/extensions/builtin/statsWidget.js";
import { StatsWidgetRegistry } from "../../shared/extensions/registries.js";

test("registerStatsWidgets 返回 Disposable", () => {
  const disposable = registerStatsWidgets();
  assert.ok(disposable);
  assert.equal(typeof disposable.dispose, "function");
  disposable.dispose();
});

test("注册后 StatsWidget Registry 有至少 2 个 builtin 条目", () => {
  const disposable = registerStatsWidgets();
  const descriptors = StatsWidgetRegistry.listDescriptors();
  assert.ok(descriptors.length >= 2);
  assert.ok(descriptors.every((d) => d.pluginId === "soto.builtin"));
  disposable.dispose();
});

test("条目 id 包含 play-count 和 playtime", () => {
  const disposable = registerStatsWidgets();
  const ids = StatsWidgetRegistry.listDescriptors().map((d) => d.id);
  assert.ok(ids.includes("play-count"));
  assert.ok(ids.includes("playtime"));
  disposable.dispose();
});

test("dispose 后 Registry 清空", () => {
  const disposable = registerStatsWidgets();
  disposable.dispose();
  assert.equal(StatsWidgetRegistry.listDescriptors().length, 0);
});

test("resolve 返回的实现有 component/defaultRowSpan/defaultColumnSpan 字段", () => {
  const disposable = registerStatsWidgets();
  const impls = StatsWidgetRegistry.resolve();
  assert.ok(impls.length > 0);
  for (const impl of impls) {
    assert.ok("component" in impl, "应有 component 字段");
    assert.ok("defaultRowSpan" in impl, "应有 defaultRowSpan 字段");
    assert.ok("defaultColumnSpan" in impl, "应有 defaultColumnSpan 字段");
    assert.equal(typeof impl.defaultRowSpan, "number");
    assert.equal(typeof impl.defaultColumnSpan, "number");
  }
  disposable.dispose();
});

test("重复调用 registerStatsWidgets 幂等（不抛错且条目数不变）", () => {
  const d1 = registerStatsWidgets();
  const countAfterFirst = StatsWidgetRegistry.listDescriptors().length;
  const d2 = registerStatsWidgets();
  const countAfterSecond = StatsWidgetRegistry.listDescriptors().length;
  assert.equal(countAfterFirst, countAfterSecond);
  d1.dispose();
  d2.dispose();
  assert.equal(StatsWidgetRegistry.listDescriptors().length, 0);
});
