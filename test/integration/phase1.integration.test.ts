/**
 * 阶段 1 集成测试：端到端验证关键链路
 *
 * 覆盖：
 * - 12 Registry 全局可访问性
 * - ExtensionRegistry 注册 → 订阅 → 注销链路
 * - PluginLifecycle 跨 Registry 批量注销
 * - CUE 歌词解析 + 歌词工具链路
 * - 评论系统数据链路
 * - 插件市场 semver 链路
 * - 任务栏歌词恢复状态链路
 * - 代理探测链路
 * - 封面加载器链路
 * - 歌词合并链路
 * - 插件设置 key 链路
 * - 扩展点查看面板链路
 * - 热更改性能 ≤16ms（跨 12 Registry 各 10 条目）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { ExtensionRegistry } from "../../shared/extensions/registry.js";
import { ALL_REGISTRIES } from "../../shared/extensions/registries.js";
import { PluginLifecycle } from "../../electron/main/plugins/lifecycle.js";
import {
  compareSemver,
  isUpdateAvailable,
} from "../../electron/main/services/pluginMarket/semver.js";
import {
  buildRecoveryState,
  shouldRecoverOnStartup,
} from "../../electron/main/services/taskbarLyric/recovery.js";
import {
  buildCommentSources,
  normalizeNeteaseComment,
} from "../../electron/main/services/comments/data.js";
import {
  isLyricEmpty,
  findActiveLineIndex,
  splitLyricLines,
} from "../../src/utils/lyricUtils.js";
import {
  parseProxyUrl,
  formatProxyUrl,
} from "../../electron/main/services/probe/proxyDetector.js";
import {
  buildCoverCacheKey,
  resolveCoverPath,
} from "../../electron/main/services/coverLoader.js";
import {
  mergeLyricLines,
  pickBestLyricSource,
} from "../../electron/main/services/lyricResolve.js";
import { buildPluginSettingsKey } from "../../src/stores/pluginSettings.js";
import {
  buildRegistryGroups,
  filterByKeyword,
} from "../../src/components/dev/extensionInspectorHelpers.js";
import type { LyricLine } from "../../shared/types/lyrics.js";
import type { PluginInfo } from "../../shared/types/plugin.js";

/** 构造合法的 LyricLine 对象 */
const makeLine = (startTime: number, endTime: number = 0): LyricLine => ({
  words: [],
  translatedLyric: "",
  romanLyric: "",
  startTime,
  endTime,
  isBG: false,
  isDuet: false,
});

test("阶段 1 集成：12 Registry 全部可访问且初始为空", () => {
  assert.equal(ALL_REGISTRIES.length, 12);
  for (const { name, registry } of ALL_REGISTRIES) {
    assert.equal(registry.resolve().length, 0, `Registry ${name} 应初始为空`);
    assert.equal(registry.listDescriptors().length, 0);
  }
});

test("阶段 1 集成：ExtensionRegistry 注册 → 订阅 → 注销链路", () => {
  const reg = new ExtensionRegistry<{ name: string }>();
  let notifyCount = 0;
  const sub = reg.subscribe(() => {
    notifyCount++;
  });

  reg.register({
    id: "test.1",
    pluginId: "p1",
    priority: 1,
    implementation: { name: "A" },
  });
  assert.equal(notifyCount, 1);
  assert.equal(reg.resolve().length, 1);

  reg.unregister("test.1");
  assert.equal(notifyCount, 2);
  assert.equal(reg.resolve().length, 0);

  sub.dispose();
  reg.register({
    id: "test.2",
    pluginId: "p1",
    priority: 1,
    implementation: { name: "B" },
  });
  assert.equal(notifyCount, 2); // 取消订阅后不触发
});

test("阶段 1 集成：PluginLifecycle 批量注销跨 Registry", async () => {
  // 在多个 Registry 中注册同一插件的条目
  const targetRegistries = ALL_REGISTRIES.slice(0, 3);
  for (const { registry } of targetRegistries) {
    registry.register({
      id: `integration.lifecycle.${registry.getVersion()}`,
      pluginId: "integrationLifecyclePlugin",
      priority: 1,
      implementation: { __test: true } as unknown,
    });
  }

  let totalBefore = 0;
  for (const { registry } of targetRegistries) {
    totalBefore += registry
      .listDescriptors()
      .filter((d) => d.pluginId === "integrationLifecyclePlugin").length;
  }
  assert.equal(totalBefore, 3);

  await PluginLifecycle.disablePlugin("integrationLifecyclePlugin");

  let totalAfter = 0;
  for (const { registry } of targetRegistries) {
    totalAfter += registry
      .listDescriptors()
      .filter((d) => d.pluginId === "integrationLifecyclePlugin").length;
  }
  assert.equal(totalAfter, 0);
});

test("阶段 1 集成：CUE 歌词解析 + 歌词工具链路", () => {
  const lrcText = "[00:01.00]第一行\n[00:03.50]第二行\n[00:05.00]第三行";
  const lines = splitLyricLines(lrcText);
  assert.equal(lines.length, 3);
  assert.equal(isLyricEmpty(lines), false);

  const activeIdx = findActiveLineIndex(lines, 4000);
  assert.equal(activeIdx, 1);
});

test("阶段 1 集成：评论系统数据链路", () => {
  const plugins: PluginInfo[] = [
    {
      manifest: {
        id: "myplugin",
        name: "My Plugin",
        version: "1.0.0",
        platform: "musicfree",
        type: "source",
        apiLevel: 1,
        hash: "",
        installedAt: 0,
        fileName: "myplugin.js",
      },
      enabled: true,
      status: {
        state: "ready",
        sources: {
          "myplugin-source": {
            name: "My Plugin",
            actions: ["getMusicComments"],
          },
        },
      },
    },
  ];

  const sources = buildCommentSources(plugins);
  // 内置源 id 为 "netease"（kind=builtin）
  assert.ok(
    sources.some((s) => s.id === "netease" && s.kind === "builtin"),
    "应包含 builtin:netease 源",
  );
  // 插件源 id 为 "<manifest.id>:<sourceKey>"
  assert.ok(
    sources.some((s) => s.id === "myplugin:myplugin-source" && s.kind === "plugin"),
    "应包含 myplugin:myplugin-source 插件源",
  );

  const comment = normalizeNeteaseComment({
    commentId: 42,
    content: "Nice",
    time: 1700000000000,
    user: { nickname: "Bob", avatarUrl: "https://x.com/avatar.jpg" },
    likedCount: 10,
    liked: false,
  });
  assert.equal(comment.id, "42");
  assert.equal(comment.userName, "Bob");
});

test("阶段 1 集成：插件市场 semver 链路", () => {
  assert.equal(isUpdateAvailable("1.0.0", "1.1.0"), true);
  assert.equal(isUpdateAvailable("1.1.0", "1.0.0"), false);
  assert.equal(compareSemver("2.0.0", "1.9.9"), 1);
});

test("阶段 1 集成：任务栏歌词恢复状态链路", () => {
  const state = buildRecoveryState({
    enabled: true,
    trackId: "netease:123",
    positionMs: 5000,
  });
  assert.equal(shouldRecoverOnStartup(state), true);

  const oldState = { ...state, timestamp: Date.now() - 25 * 60 * 60 * 1000 };
  assert.equal(shouldRecoverOnStartup(oldState), false);
});

test("阶段 1 集成：代理探测链路", () => {
  const config = parseProxyUrl("socks5://user:pass@127.0.0.1:1080");
  assert.ok(config);
  assert.equal(config!.protocol, "socks5");
  assert.equal(formatProxyUrl(config!), "socks5://user:pass@127.0.0.1:1080");
});

test("阶段 1 集成：封面加载器链路", () => {
  const key = buildCoverCacheKey("netease", "12345");
  assert.equal(key, "cover:netease:12345");
  const path = resolveCoverPath("https://p1.music.126.net/abc.jpg", "/cache");
  assert.ok(path.includes("cover_"));
});

test("阶段 1 集成：歌词合并链路", () => {
  const a: LyricLine[] = [makeLine(0)];
  const b: LyricLine[] = [makeLine(1000)];
  const merged = mergeLyricLines(a, b);
  assert.equal(merged.length, 2);

  const best = pickBestLyricSource([
    { sourceId: "x", lines: a, quality: 0.5 },
    { sourceId: "y", lines: [...a, ...b], quality: 0.8 },
  ]);
  assert.equal(best?.sourceId, "y");
});

test("阶段 1 集成：插件设置 key 链路", () => {
  const key = buildPluginSettingsKey("myplugin", "volume");
  assert.equal(key, "plugin.myplugin.volume");
});

test("阶段 1 集成：扩展点查看面板链路", () => {
  const groups = buildRegistryGroups();
  assert.equal(groups.length, 12);
  const filtered = filterByKeyword([], "test");
  assert.equal(filtered.length, 0);
});

test("阶段 1 集成：热更改性能 ≤16ms（跨 12 Registry 各 10 条目）", async () => {
  // 在每个 Registry 注册 10 个条目
  for (const { registry } of ALL_REGISTRIES) {
    for (let i = 0; i < 10; i++) {
      try {
        registry.register({
          id: `perf.test.${i}.${registry.getVersion()}`,
          pluginId: "perfTestPlugin",
          priority: i,
          implementation: { __perf: true } as unknown,
        });
      } catch {
        // 某些 Registry 可能有类型约束，忽略
      }
    }
  }

  const start = performance.now();
  await PluginLifecycle.disablePlugin("perfTestPlugin");
  const elapsed = performance.now() - start;

  assert.ok(elapsed < 16, `expected <16ms, got ${elapsed}ms`);
});
