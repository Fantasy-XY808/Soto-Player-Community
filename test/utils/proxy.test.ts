import { test } from "node:test";
import assert from "node:assert/strict";
import { getNetworkProxyUrl } from "../../electron/main/utils/proxy.js";

// 由于 proxy.ts 依赖 store（electron-store），需要 mock
// 这里仅测试 getNetworkProxyUrl 的纯函数逻辑

test("getNetworkProxyUrl 返回 off 时空字符串", () => {
  const original = (globalThis as any).__sotoStore;
  (globalThis as any).__sotoStore = {
    get: () => ({ protocol: "off", host: "127.0.0.1", port: 7890, username: "", password: "" }),
  };
  try {
    assert.equal(getNetworkProxyUrl(), "");
  } finally {
    (globalThis as any).__sotoStore = original;
  }
});

test("getNetworkProxyUrl 返回 http 协议时构造完整 URL", () => {
  const original = (globalThis as any).__sotoStore;
  (globalThis as any).__sotoStore = {
    get: () => ({ protocol: "http", host: "127.0.0.1", port: 7890, username: "", password: "" }),
  };
  try {
    assert.equal(getNetworkProxyUrl(), "http://127.0.0.1:7890");
  } finally {
    (globalThis as any).__sotoStore = original;
  }
});

test("getNetworkProxyUrl 含账密时构造带认证 URL", () => {
  const original = (globalThis as any).__sotoStore;
  (globalThis as any).__sotoStore = {
    get: () => ({ protocol: "http", host: "127.0.0.1", port: 7890, username: "u", password: "p" }),
  };
  try {
    assert.equal(getNetworkProxyUrl(), "http://u:p@127.0.0.1:7890");
  } finally {
    (globalThis as any).__sotoStore = original;
  }
});

test("getNetworkProxyUrl host 为空时返回空字符串", () => {
  const original = (globalThis as any).__sotoStore;
  (globalThis as any).__sotoStore = {
    get: () => ({ protocol: "http", host: "", port: 7890, username: "", password: "" }),
  };
  try {
    assert.equal(getNetworkProxyUrl(), "");
  } finally {
    (globalThis as any).__sotoStore = original;
  }
});
