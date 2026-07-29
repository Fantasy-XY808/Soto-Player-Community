import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPluginSettingsKey,
  isPluginSettingRegistered,
  getPluginSettingDefault,
  type PluginSettingDefinition,
} from "../../src/stores/pluginSettings.js";

test("buildPluginSettingsKey 生成 plugin.<id>.<key> 格式", () => {
  assert.equal(buildPluginSettingsKey("myplugin", "volume"), "plugin.myplugin.volume");
  assert.equal(buildPluginSettingsKey("soto.builtin", "theme"), "plugin.soto.builtin.theme");
});

test("isPluginSettingRegistered 检查定义是否存在", () => {
  const defs = new Map<string, PluginSettingDefinition>([
    ["plugin.myplugin.volume", { key: "volume", type: "number", defaultValue: 50, pluginId: "myplugin" }],
  ]);
  assert.equal(isPluginSettingRegistered(defs, "myplugin", "volume"), true);
  assert.equal(isPluginSettingRegistered(defs, "myplugin", "unknown"), false);
});

test("getPluginSettingDefault 返回默认值", () => {
  const defs = new Map<string, PluginSettingDefinition>([
    ["plugin.myplugin.volume", { key: "volume", type: "number", defaultValue: 75, pluginId: "myplugin" }],
  ]);
  assert.equal(getPluginSettingDefault(defs, "myplugin", "volume"), 75);
  assert.equal(getPluginSettingDefault(defs, "myplugin", "missing"), undefined);
});

test("getPluginSettingDefault 支持 boolean/string/number 类型", () => {
  const defs = new Map<string, PluginSettingDefinition>([
    ["plugin.p.enabled", { key: "enabled", type: "boolean", defaultValue: true, pluginId: "p" }],
    ["plugin.p.name", { key: "name", type: "string", defaultValue: "test", pluginId: "p" }],
    ["plugin.p.count", { key: "count", type: "number", defaultValue: 42, pluginId: "p" }],
  ]);
  assert.equal(getPluginSettingDefault(defs, "p", "enabled"), true);
  assert.equal(getPluginSettingDefault(defs, "p", "name"), "test");
  assert.equal(getPluginSettingDefault(defs, "p", "count"), 42);
});
