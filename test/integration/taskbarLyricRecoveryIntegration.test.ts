/**
 * 任务栏歌词恢复状态集成测试
 *
 * 端到端验证 recovery.ts 持久化链路：
 * - 写入 → 读取 → 判断恢复 → 清除 完整链路
 * - 过期状态（>24h）不恢复
 * - 未启用状态不恢复
 *
 * 作为 window/index.ts 与 taskbarLyric.ts 接入恢复逻辑后的回归保护。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  buildRecoveryState,
  writeRecoveryState,
  readRecoveryState,
  shouldRecoverOnStartup,
  clearRecoveryState,
} from "../../electron/main/services/taskbarLyric/recovery.js";

test("集成：写入 → 读取 → 判断恢复 → 清除 完整链路", async () => {
  const dir = await mkdtemp(join(tmpdir(), "soto-recovery-"));
  try {
    const state = buildRecoveryState({
      enabled: true,
      trackId: "netease:12345",
      positionMs: 30000,
    });
    await writeRecoveryState(dir, state);

    const read = await readRecoveryState(dir);
    assert.ok(read);
    assert.equal(shouldRecoverOnStartup(read!), true);

    await clearRecoveryState(dir);
    const after = await readRecoveryState(dir);
    assert.equal(after, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("集成：过期状态不恢复", async () => {
  const dir = await mkdtemp(join(tmpdir(), "soto-recovery-expired-"));
  try {
    const state = buildRecoveryState({
      enabled: true,
      trackId: "netease:12345",
      positionMs: 0,
      timestamp: Date.now() - 25 * 60 * 60 * 1000,
    });
    await writeRecoveryState(dir, state);

    const read = await readRecoveryState(dir);
    assert.ok(read);
    assert.equal(shouldRecoverOnStartup(read!), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("集成：未启用不恢复", async () => {
  const dir = await mkdtemp(join(tmpdir(), "soto-recovery-disabled-"));
  try {
    const state = buildRecoveryState({
      enabled: false,
      trackId: "netease:12345",
      positionMs: 0,
    });
    await writeRecoveryState(dir, state);

    const read = await readRecoveryState(dir);
    assert.ok(read);
    assert.equal(shouldRecoverOnStartup(read!), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
