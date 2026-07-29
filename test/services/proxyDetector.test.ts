import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseProxyUrl,
  formatProxyUrl,
  isProxyReachable,
  type ProxyConfig,
} from "../../electron/main/services/probe/proxyDetector.js";

test("parseProxyUrl 解析 http 代理", () => {
  const config = parseProxyUrl("http://127.0.0.1:7890");
  assert.equal(config?.protocol, "http");
  assert.equal(config?.host, "127.0.0.1");
  assert.equal(config?.port, 7890);
});

test("parseProxyUrl 解析 socks5 带认证", () => {
  const config = parseProxyUrl("socks5://user:pass@10.0.0.1:1080");
  assert.equal(config?.protocol, "socks5");
  assert.equal(config?.host, "10.0.0.1");
  assert.equal(config?.port, 1080);
  assert.equal(config?.username, "user");
  assert.equal(config?.password, "pass");
});

test("parseProxyUrl 无效 URL 返回 null", () => {
  assert.equal(parseProxyUrl("not-a-url"), null);
  assert.equal(parseProxyUrl(""), null);
});

test("formatProxyUrl 格式化回 URL 字符串", () => {
  const config: ProxyConfig = { protocol: "http", host: "127.0.0.1", port: 7890 };
  assert.equal(formatProxyUrl(config), "http://127.0.0.1:7890");
});

test("formatProxyUrl 带认证", () => {
  const config: ProxyConfig = {
    protocol: "socks5",
    host: "10.0.0.1",
    port: 1080,
    username: "user",
    password: "pass",
  };
  assert.equal(formatProxyUrl(config), "socks5://user:pass@10.0.0.1:1080");
});

test("isProxyReachable 是函数", () => {
  assert.equal(typeof isProxyReachable, "function");
});
