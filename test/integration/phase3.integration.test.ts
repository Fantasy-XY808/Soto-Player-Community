/**
 * 阶段 3 集成测试：内置扩展点端到端验证
 *
 * 覆盖：
 * - registerBuiltinExtensions 后 6 个 Registry 各有至少 1 个 builtin 条目
 * - 6 个 Registry 的具体条目数量正确（合计 19 个）
 * - dispose 后所有 Registry 清空
 * - PluginLifecycle.disablePlugin("soto.builtin") 清空所有 builtin 条目
 * - 扩展点查看面板 buildRegistryGroups / buildDescriptorRows / filterByKeyword 链路
 * - 注册 + dispose 性能 ≤16ms
 * - registerBuiltinExtensions 可重复调用（幂等，不翻倍）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerBuiltinExtensions } from "../../src/extensions/builtin/index.js";
import { ALL_REGISTRIES } from "../../shared/extensions/registries.js";
import { PluginLifecycle } from "../../electron/main/plugins/lifecycle.js";
import {
  buildRegistryGroups,
  filterByKeyword,
  buildDescriptorRows,
} from "../../src/components/dev/extensionInspectorHelpers.js";

// 6 个已注册 builtin 的 Registry 名（与 ALL_REGISTRIES 中的 name 字段一致）
const EXPECTED_REGISTERED_NAMES = [
  "LyricsCardStyle",
  "SpectrumStyle",
  "BackgroundOverlay",
  "MusicSource",
  "LyricsSource",
  "WindowMode",
] as const;

test("阶段 3 集成：registerBuiltinExtensions 后 6 个 Registry 各有 builtin 条目", () => {
  const disposable = registerBuiltinExtensions();
  try {
    for (const name of EXPECTED_REGISTERED_NAMES) {
      const group = ALL_REGISTRIES.find((g) => g.name === name);
      assert.ok(group, `Registry ${name} 应存在`);
      const descriptors = group.registry.listDescriptors();
      assert.ok(
        descriptors.length > 0,
        `Registry ${name} 应有 builtin 条目，实际 ${descriptors.length}`,
      );
      assert.ok(
        descriptors.every((d) => d.pluginId === "soto.builtin"),
        `Registry ${name} 所有条目应为 soto.builtin`,
      );
    }
  } finally {
    disposable.dispose();
  }
});

test("阶段 3 集成：具体条目数量正确", () => {
  const disposable = registerBuiltinExtensions();
  try {
    const expectations: Record<string, number> = {
      LyricsCardStyle: 4,
      SpectrumStyle: 3,
      BackgroundOverlay: 3,
      MusicSource: 3,
      LyricsSource: 2,
      WindowMode: 4,
    };
    for (const [name, count] of Object.entries(expectations)) {
      const group = ALL_REGISTRIES.find((g) => g.name === name);
      assert.ok(group, `Registry ${name} 应存在`);
      const actual = group.registry.listDescriptors().length;
      assert.equal(
        actual,
        count,
        `Registry ${name} 应有 ${count} 个条目，实际 ${actual}`,
      );
    }
  } finally {
    disposable.dispose();
  }
});

test("阶段 3 集成：dispose 后所有 Registry 清空", () => {
  const disposable = registerBuiltinExtensions();
  disposable.dispose();
  for (const name of EXPECTED_REGISTERED_NAMES) {
    const group = ALL_REGISTRIES.find((g) => g.name === name);
    assert.ok(group, `Registry ${name} 应存在`);
    assert.equal(
      group.registry.listDescriptors().length,
      0,
      `Registry ${name} dispose 后应清空`,
    );
  }
});

test("阶段 3 集成：PluginLifecycle.disablePlugin 清空 builtin 条目", async () => {
  const disposable = registerBuiltinExtensions();
  try {
    // 确认注册成功（合计 ≥19）
    const beforeCount = ALL_REGISTRIES.reduce(
      (sum, g) => sum + g.registry.listDescriptors().length,
      0,
    );
    assert.ok(beforeCount >= 19, `注册后应有 ≥19 条目，实际 ${beforeCount}`);

    // disablePlugin 应清空所有 soto.builtin 条目
    await PluginLifecycle.disablePlugin("soto.builtin");

    const afterCount = ALL_REGISTRIES.reduce(
      (sum, g) =>
        sum +
        g.registry
          .listDescriptors()
          .filter((d) => d.pluginId === "soto.builtin").length,
      0,
    );
    assert.equal(
      afterCount,
      0,
      `disablePlugin 后应无 soto.builtin 条目，实际 ${afterCount}`,
    );
  } finally {
    // disablePlugin 已删除条目，dispose 是 no-op，但仍调用以维持契约
    disposable.dispose();
  }
});

test("阶段 3 集成：扩展点查看面板能展示 builtin 条目", () => {
  const disposable = registerBuiltinExtensions();
  try {
    const groups = buildRegistryGroups();
    assert.equal(groups.length, 12);

    // 找到 LyricsCardStyle 分组
    const cardGroup = groups.find((g) => g.name === "LyricsCardStyle");
    assert.ok(cardGroup, "LyricsCardStyle 分组应存在");
    const cardDescriptors = cardGroup.registry.listDescriptors();
    const rows = buildDescriptorRows(cardDescriptors);
    assert.ok(rows.length >= 4, `LyricsCardStyle 行数应 ≥4，实际 ${rows.length}`);

    // 过滤关键字 "classic"
    const filtered = filterByKeyword(rows, "classic");
    assert.ok(filtered.length >= 1, `应能过滤出 classic，实际 ${filtered.length}`);
    assert.ok(
      filtered.some((r) => r.id.includes("classic")),
      "过滤结果应包含 id 含 classic 的行",
    );
  } finally {
    disposable.dispose();
  }
});

test("阶段 3 集成：注册+dispose 性能 ≤16ms", () => {
  const start = performance.now();
  const disposable = registerBuiltinExtensions();
  disposable.dispose();
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 16, `注册+dispose 应 ≤16ms，实际 ${elapsed}ms`);
});

test("阶段 3 集成：可重复注册（幂等）", () => {
  const d1 = registerBuiltinExtensions();
  const d2 = registerBuiltinExtensions();
  // 第二次注册应跳过已存在条目，不报错
  const cardGroup = ALL_REGISTRIES.find((g) => g.name === "LyricsCardStyle");
  assert.ok(cardGroup, "LyricsCardStyle 分组应存在");
  assert.equal(
    cardGroup.registry.listDescriptors().length,
    4,
    "重复注册不应翻倍，仍为 4",
  );
  d1.dispose();
  d2.dispose();
  // 两次 dispose 后应清空
  assert.equal(
    cardGroup.registry.listDescriptors().length,
    0,
    "两次 dispose 后应清空",
  );
});
