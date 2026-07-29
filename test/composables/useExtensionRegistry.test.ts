import { test } from "node:test";
import assert from "node:assert/strict";

test("useExtensionRegistry composable 可被导入", async () => {
  const mod = await import("../../src/composables/useExtensionRegistry.js");
  assert.equal(typeof mod.useExtensionRegistry, "function");
});
