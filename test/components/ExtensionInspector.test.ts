import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRegistryGroups,
  buildDescriptorRows,
  filterByKeyword,
  formatPriority,
  type DescriptorRow,
} from "../../src/components/dev/extensionInspectorHelpers.js";

test("buildRegistryGroups 返回 12 个分组", () => {
  const groups = buildRegistryGroups();
  assert.equal(groups.length, 12);
  assert.ok(groups.every((g) => g.name && g.registry));
});

test("buildDescriptorRows 从描述符列表构建行数据", () => {
  const descriptors = [
    { id: "a", pluginId: "p1", priority: 10, implementation: {}, metadata: { author: "x" } },
    { id: "b", pluginId: "p2", priority: 5, implementation: {}, metadata: undefined },
  ];
  const rows = buildDescriptorRows(descriptors);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "a");
  assert.equal(rows[0].pluginId, "p1");
  assert.equal(rows[0].priority, 10);
  assert.equal(rows[0].hasMetadata, true);
  assert.equal(rows[1].hasMetadata, false);
});

test("filterByKeyword 按 id/pluginId/metadata 关键字过滤", () => {
  const rows: DescriptorRow[] = [
    { id: "lyricsCard.vinyl", pluginId: "soto.builtin", priority: 10, hasMetadata: true, metadata: { author: "team" } },
    { id: "lyricsCard.minimal", pluginId: "user.custom", priority: 5, hasMetadata: false, metadata: undefined },
    { id: "spectrum.bar", pluginId: "soto.builtin", priority: 8, hasMetadata: false, metadata: undefined },
  ];
  const filtered = filterByKeyword(rows, "vinyl");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].id, "lyricsCard.vinyl");
});

test("filterByKeyword 空 keyword 返回全部", () => {
  const rows: DescriptorRow[] = [
    { id: "a", pluginId: "p1", priority: 1, hasMetadata: false, metadata: undefined },
  ];
  assert.equal(filterByKeyword(rows, "").length, 1);
  assert.equal(filterByKeyword(rows, "   ").length, 1);
});

test("filterByKeyword 匹配 pluginId", () => {
  const rows: DescriptorRow[] = [
    { id: "a", pluginId: "soto.builtin", priority: 1, hasMetadata: false, metadata: undefined },
    { id: "b", pluginId: "user.custom", priority: 2, hasMetadata: false, metadata: undefined },
  ];
  assert.equal(filterByKeyword(rows, "soto").length, 1);
});

test("filterByKeyword 匹配 metadata 值", () => {
  const rows: DescriptorRow[] = [
    { id: "a", pluginId: "p1", priority: 1, hasMetadata: true, metadata: { author: "alice", version: "1.0" } },
    { id: "b", pluginId: "p2", priority: 2, hasMetadata: true, metadata: { author: "bob" } },
  ];
  assert.equal(filterByKeyword(rows, "alice").length, 1);
});

test("formatPriority 格式化优先级", () => {
  assert.equal(formatPriority(10), "10");
  assert.equal(formatPriority(0), "0");
  assert.equal(formatPriority(-5), "-5");
});
