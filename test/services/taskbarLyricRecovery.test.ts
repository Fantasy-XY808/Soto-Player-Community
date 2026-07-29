import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRecoveryState,
  shouldRecoverOnStartup,
  isRecoveryStateValid,
  type TaskbarLyricRecoveryState,
} from "../../electron/main/services/taskbarLyric/recovery.js";

test("buildRecoveryState 构建恢复状态对象", () => {
  const state = buildRecoveryState({
    enabled: true,
    trackId: "netease:12345",
    positionMs: 60000,
    timestamp: Date.now(),
  });
  assert.equal(state.enabled, true);
  assert.equal(state.trackId, "netease:12345");
  assert.equal(state.positionMs, 60000);
  assert.ok(state.timestamp > 0);
  assert.equal(state.version, 1);
});

test("shouldRecoverOnStartup 启用且 24 小时内返回 true", () => {
  const state: TaskbarLyricRecoveryState = {
    enabled: true,
    trackId: "netease:12345",
    positionMs: 0,
    timestamp: Date.now() - 1000 * 60 * 60, // 1 小时前
    version: 1,
  };
  assert.equal(shouldRecoverOnStartup(state, Date.now()), true);
});

test("shouldRecoverOnStartup 超过 24 小时返回 false", () => {
  const state: TaskbarLyricRecoveryState = {
    enabled: true,
    trackId: "netease:12345",
    positionMs: 0,
    timestamp: Date.now() - 1000 * 60 * 60 * 25, // 25 小时前
    version: 1,
  };
  assert.equal(shouldRecoverOnStartup(state, Date.now()), false);
});

test("shouldRecoverOnStartup 未启用返回 false", () => {
  const state: TaskbarLyricRecoveryState = {
    enabled: false,
    trackId: "",
    positionMs: 0,
    timestamp: Date.now(),
    version: 1,
  };
  assert.equal(shouldRecoverOnStartup(state, Date.now()), false);
});

test("isRecoveryStateValid 版本不匹配返回 false", () => {
  const state = {
    enabled: true,
    trackId: "x",
    positionMs: 0,
    timestamp: Date.now(),
    version: 99,
  };
  assert.equal(isRecoveryStateValid(state), false);
});

test("isRecoveryStateValid 缺少必需字段返回 false", () => {
  assert.equal(isRecoveryStateValid(null), false);
  assert.equal(isRecoveryStateValid({}), false);
  assert.equal(isRecoveryStateValid({ enabled: true }), false);
});

test("isRecoveryStateValid 合法状态返回 true", () => {
  const state: TaskbarLyricRecoveryState = {
    enabled: true,
    trackId: "netease:12345",
    positionMs: 0,
    timestamp: Date.now(),
    version: 1,
  };
  assert.equal(isRecoveryStateValid(state), true);
});
