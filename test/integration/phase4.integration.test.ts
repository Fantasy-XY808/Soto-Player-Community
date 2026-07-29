/**
 * 阶段 4 集成测试：12 个 Registry 全覆盖端到端验证
 *
 * 覆盖：
 * - registerBuiltinExtensions 后 12 个 Registry 各有至少 1 个 builtin 条目
 * - 12 个 Registry 的具体条目数量正确（合计 36 个）
 * - builtin 条目总数 ≥28
 * - dispose 后所有 12 个 Registry 清空
 * - PluginLifecycle.disablePlugin("soto.builtin") 清空所有 builtin 条目
 * - 注册 + dispose 性能 ≤16ms
 * - registerBuiltinExtensions 可重复调用（幂等，不翻倍）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { registerBuiltinExtensions } from "../../src/extensions/builtin/index.js";
import { ALL_REGISTRIES } from "../../shared/extensions/registries.js";
import { PluginLifecycle } from "../../electron/main/plugins/lifecycle.js";

// 12 个 Registry 全部应有 builtin 条目
test("阶段 4 集成：12 个 Registry 全部有 builtin 条目", () => {
  const disposable = registerBuiltinExtensions();
  try {
    assert.equal(ALL_REGISTRIES.length, 12, "应有 12 个 Registry");
    for (const { name, registry } of ALL_REGISTRIES) {
      const descriptors = registry.listDescriptors();
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

test("阶段 4 集成：builtin 条目总数 ≥28", () => {
  // 阶段3: 4+3+3+3+2+4=19，阶段4: 4+4+2+3+2+2=17，合计 36
  const disposable = registerBuiltinExtensions();
  try {
    const total = ALL_REGISTRIES.reduce(
      (sum, g) => sum + g.registry.listDescriptors().length,
      0,
    );
    assert.ok(total >= 28, `builtin 条目总数应 ≥28，实际 ${total}`);
  } finally {
    disposable.dispose();
  }
});

test("阶段 4 集成：dispose 后 12 Registry 全部清空", () => {
  const disposable = registerBuiltinExtensions();
  disposable.dispose();
  for (const { name, registry } of ALL_REGISTRIES) {
    assert.equal(
      registry.listDescriptors().length,
      0,
      `Registry ${name} dispose 后应清空`,
    );
  }
});

test("阶段 4 集成：PluginLifecycle.disablePlugin 清空全部 builtin", async () => {
  const disposable = registerBuiltinExtensions();
  try {
    await PluginLifecycle.disablePlugin("soto.builtin");
    const remaining = ALL_REGISTRIES.reduce(
      (sum, g) =>
        sum +
        g.registry
          .listDescriptors()
          .filter((d) => d.pluginId === "soto.builtin").length,
      0,
    );
    assert.equal(
      remaining,
      0,
      `disablePlugin 后应无 builtin 条目，实际 ${remaining}`,
    );
  } finally {
    disposable.dispose();
  }
});

test("阶段 4 集成：各 Registry 条目数符合预期", () => {
  const disposable = registerBuiltinExtensions();
  try {
    // 以 src/extensions/builtin/index.ts 实际注册数为准
    // 阶段 3：LyricsCardStyle 4, SpectrumStyle 3, BackgroundOverlay 3,
    //         MusicSource 3, LyricsSource 2, WindowMode 4
    // 阶段 4：LyricsEffect 4, LayoutProfile 4, LyricsEngine 2,
    //         StatsWidget 3, TranslationProvider 2, TransliterationProvider 2
    const expectations: Record<string, number> = {
      LyricsCardStyle: 4,
      SpectrumStyle: 3,
      BackgroundOverlay: 3,
      MusicSource: 3,
      LyricsSource: 2,
      WindowMode: 4,
      LyricsEffect: 4,
      LayoutProfile: 4,
      LyricsEngine: 2,
      StatsWidget: 3,
      TranslationProvider: 2,
      TransliterationProvider: 2,
    };
    for (const [name, expected] of Object.entries(expectations)) {
      const group = ALL_REGISTRIES.find((g) => g.name === name);
      assert.ok(group, `Registry ${name} 应存在`);
      const actual = group.registry.listDescriptors().length;
      assert.equal(
        actual,
        expected,
        `Registry ${name} 应有 ${expected} 条目，实际 ${actual}`,
      );
    }
  } finally {
    disposable.dispose();
  }
});

test("阶段 4 集成：注册+dispose 性能 ≤16ms", () => {
  const start = performance.now();
  const disposable = registerBuiltinExtensions();
  disposable.dispose();
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 16, `注册+dispose 应 ≤16ms，实际 ${elapsed}ms`);
});

test("阶段 4 集成：幂等性（重复注册不翻倍）", () => {
  const d1 = registerBuiltinExtensions();
  const d2 = registerBuiltinExtensions();
  const total = ALL_REGISTRIES.reduce(
    (sum, g) => sum + g.registry.listDescriptors().length,
    0,
  );
  // 第二次注册应跳过已存在条目，总数不应翻倍
  // 12 Registry 合计 36，幂等下应保持 36（允许少量偏差 ≤5）
  const expected = 36;
  assert.ok(
    total <= expected + 5,
    `重复注册不应翻倍，总数 ${total}，预期 ≤${expected + 5}`,
  );
  d1.dispose();
  d2.dispose();
  // 两次 dispose 后所有 Registry 应清空
  for (const { name, registry } of ALL_REGISTRIES) {
    assert.equal(
      registry.listDescriptors().length,
      0,
      `Registry ${name} 两次 dispose 后应清空`,
    );
  }
});
