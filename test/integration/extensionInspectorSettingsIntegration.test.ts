/**
 * 扩展点查看面板接入设置页集成测试
 *
 * 验证 Task 26：将 ExtensionInspector.vue 接入设置 schema，作为 advanced 分类。
 * - 设置 schema 包含 developer 分类
 * - 设置 schema 引用 ExtensionInspector 组件
 * - developer 分类标记为 advanced（仅专业模式可见）
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("设置 schema 包含 developer 分类", () => {
  const content = readFileSync(
    resolve(process.cwd(), "src/settings/schema.ts"),
    "utf-8",
  );
  assert.ok(content.includes("developer"), "schema.ts 应包含 developer 分类");
});

test("设置 schema 引用 ExtensionInspector", () => {
  const content = readFileSync(
    resolve(process.cwd(), "src/settings/schema.ts"),
    "utf-8",
  );
  assert.ok(
    content.includes("ExtensionInspector"),
    "schema.ts 应 import 并引用 ExtensionInspector 组件",
  );
});

test("developer 分类标记为 advanced", () => {
  const content = readFileSync(
    resolve(process.cwd(), "src/settings/schema.ts"),
    "utf-8",
  );
  // 找到 developer 分类定义，确认含 advanced: true
  const devIdx = content.indexOf("developer");
  assert.ok(devIdx > -1);
  const snippet = content.slice(devIdx, devIdx + 300);
  assert.ok(
    snippet.includes("advanced"),
    "developer 分类应标记 advanced: true",
  );
});
