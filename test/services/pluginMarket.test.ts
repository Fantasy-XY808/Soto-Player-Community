import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareSemver,
  isUpdateAvailable,
  satisfiesRange,
  parseVersion,
} from "../../electron/main/services/pluginMarket/semver.js";
import {
  buildMarketIndexUrl,
  normalizeMarketEntry,
  type MarketEntry,
} from "../../electron/main/services/pluginMarket/index.js";

test("parseVersion 解析语义化版本", () => {
  const v = parseVersion("1.2.3");
  assert.equal(v.major, 1);
  assert.equal(v.minor, 2);
  assert.equal(v.patch, 3);
});

test("parseVersion 解析预发布版本", () => {
  const v = parseVersion("1.0.0-beta.1");
  assert.equal(v.major, 1);
  assert.equal(v.minor, 0);
  assert.equal(v.patch, 0);
  assert.equal(v.prerelease, "beta.1");
});

test("compareSemver 基本比较", () => {
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
  assert.equal(compareSemver("1.0.0", "2.0.0"), -1);
  assert.equal(compareSemver("2.0.0", "1.0.0"), 1);
  assert.equal(compareSemver("1.0.0", "1.0.1"), -1);
  assert.equal(compareSemver("1.1.0", "1.0.0"), 1);
});

test("compareSemver 预发布版本低于正式版本", () => {
  assert.equal(compareSemver("1.0.0-beta", "1.0.0"), -1);
  assert.equal(compareSemver("1.0.0", "1.0.0-beta"), 1);
});

test("isUpdateAvailable 检测更新", () => {
  assert.equal(isUpdateAvailable("1.0.0", "1.0.1"), true);
  assert.equal(isUpdateAvailable("1.0.1", "1.0.0"), false);
  assert.equal(isUpdateAvailable("1.0.0", "1.0.0"), false);
});

test("satisfiesRange 检查版本范围", () => {
  assert.equal(satisfiesRange("1.0.0", "^1.0.0"), true);
  assert.equal(satisfiesRange("1.5.0", "^1.0.0"), true);
  assert.equal(satisfiesRange("2.0.0", "^1.0.0"), false);
  assert.equal(satisfiesRange("1.2.3", "~1.2.0"), true);
  assert.equal(satisfiesRange("1.3.0", "~1.2.0"), false);
});

test("buildMarketIndexUrl 构建市场索引 URL", () => {
  const url = buildMarketIndexUrl("https://market.example.com", "stable");
  assert.equal(url, "https://market.example.com/index.json?channel=stable");
});

test("normalizeMarketEntry 标准化市场条目", () => {
  const raw = {
    id: "myplugin",
    name: "My Plugin",
    version: "1.0.0",
    description: "A test plugin",
    author: "dev",
    downloadUrl: "https://example.com/plugin.tar.gz",
    sha256: "abc123",
    homepage: "https://example.com",
  };
  const entry = normalizeMarketEntry(raw);
  assert.equal(entry.id, "myplugin");
  assert.equal(entry.name, "My Plugin");
  assert.equal(entry.version, "1.0.0");
  assert.equal(entry.downloadUrl, "https://example.com/plugin.tar.gz");
  assert.equal(entry.sha256, "abc123");
});

test("normalizeMarketEntry 缺少必需字段返回 null", () => {
  assert.equal(normalizeMarketEntry({ id: "x" }), null);
  assert.equal(normalizeMarketEntry(null), null);
});
