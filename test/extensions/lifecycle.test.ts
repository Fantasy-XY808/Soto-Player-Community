import { test } from "node:test";
import assert from "node:assert/strict";
import { PluginLifecycle } from "../../electron/main/plugins/lifecycle.js";
import { LyricsCardStyleRegistry } from "../../shared/extensions/registries.js";
import type { LyricsCardStyleDescriptor, LyricsCardData } from "../../shared/types/plugin-extensions.js";
import type { Disposable } from "../../shared/extensions/disposable.js";

const makeFakeDescriptor = (id: string, pluginId: string): LyricsCardStyleDescriptor => ({
  id,
  label: id,
  fontFamily: "",
  render: (_container: HTMLElement, _data: LyricsCardData): Disposable => ({ dispose: () => {} }),
});

test("PluginLifecycle.disablePlugin 触发所有 Registry 卸载该插件条目", async () => {
  LyricsCardStyleRegistry.register({
    id: "card.lifecycle-test",
    pluginId: "pluginLifecycleTest",
    priority: 1,
    implementation: makeFakeDescriptor("card.lifecycle-test", "pluginLifecycleTest"),
  });

  const before = LyricsCardStyleRegistry.resolveDescriptor("card.lifecycle-test");
  assert.ok(before);

  await PluginLifecycle.disablePlugin("pluginLifecycleTest");

  const after = LyricsCardStyleRegistry.resolveDescriptor("card.lifecycle-test");
  assert.equal(after, undefined);
});

test("PluginLifecycle.disablePlugin 性能 ≤16ms（100 个条目跨 12 Registry）", async () => {
  for (let i = 0; i < 100; i++) {
    LyricsCardStyleRegistry.register({
      id: `card.perf-lifecycle-${i}`,
      pluginId: "pluginLifecyclePerf",
      priority: i,
      implementation: makeFakeDescriptor(`card.perf-lifecycle-${i}`, "pluginLifecyclePerf"),
    });
  }

  const start = performance.now();
  await PluginLifecycle.disablePlugin("pluginLifecyclePerf");
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 16, `expected <16ms, got ${elapsed}ms`);
});
