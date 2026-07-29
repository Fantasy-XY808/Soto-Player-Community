import { test } from "node:test";
import assert from "node:assert/strict";

test("extensions IPC 模块可被导入", async () => {
  const mod = await import("../../electron/main/ipc/extensions.js");
  assert.equal(typeof mod.registerExtensionsIpc, "function");
});
