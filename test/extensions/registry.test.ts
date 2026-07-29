import { test } from "node:test";
import assert from "node:assert/strict";
import { ExtensionRegistry } from "../../shared/extensions/registry.js";
import { CompositeDisposable } from "../../shared/extensions/disposable.js";

test("ExtensionRegistry.register 与 resolve", () => {
  const reg = new ExtensionRegistry<{ name: string }>();
  reg.register({
    id: "a",
    pluginId: "p1",
    priority: 10,
    implementation: { name: "A" },
  });
  reg.register({
    id: "b",
    pluginId: "p1",
    priority: 20,
    implementation: { name: "B" },
  });
  const resolved = reg.resolve();
  assert.equal(resolved.length, 2);
  assert.equal(resolved[0].name, "B"); // 优先级降序
  assert.equal(resolved[1].name, "A");
});

test("ExtensionRegistry.unregister 移除单个条目", () => {
  const reg = new ExtensionRegistry<{ name: string }>();
  reg.register({ id: "a", pluginId: "p1", priority: 1, implementation: { name: "A" } });
  reg.unregister("a");
  assert.equal(reg.resolve().length, 0);
});

test("ExtensionRegistry.unregisterByPlugin 批量移除（热更改核心）", () => {
  const reg = new ExtensionRegistry<{ name: string }>();
  reg.register({ id: "a", pluginId: "p1", priority: 1, implementation: { name: "A" } });
  reg.register({ id: "b", pluginId: "p1", priority: 2, implementation: { name: "B" } });
  reg.register({ id: "c", pluginId: "p2", priority: 3, implementation: { name: "C" } });
  reg.unregisterByPlugin("p1");
  assert.equal(reg.resolve().length, 1);
  assert.equal(reg.resolve()[0].name, "C");
});

test("ExtensionRegistry.subscribe 监听 version 变化", () => {
  const reg = new ExtensionRegistry<{ name: string }>();
  let calls = 0;
  const sub = reg.subscribe(() => { calls++; });
  reg.register({ id: "a", pluginId: "p1", priority: 1, implementation: { name: "A" } });
  assert.equal(calls, 1);
  reg.unregister("a");
  assert.equal(calls, 2);
  sub.dispose();
  reg.register({ id: "b", pluginId: "p1", priority: 1, implementation: { name: "B" } });
  assert.equal(calls, 2); // 取消订阅后不再触发
});

test("ExtensionRegistry.register 返回的 Disposable 调用后移除条目", () => {
  const reg = new ExtensionRegistry<{ name: string }>();
  const d = reg.register({ id: "a", pluginId: "p1", priority: 1, implementation: { name: "A" } });
  assert.equal(reg.resolve().length, 1);
  d.dispose();
  assert.equal(reg.resolve().length, 0);
});

test("CompositeDisposable 批量 dispose", () => {
  let disposed = 0;
  const cd = new CompositeDisposable();
  cd.add({ dispose: () => { disposed++; } });
  cd.add({ dispose: () => { disposed++; } });
  cd.dispose();
  assert.equal(disposed, 2);
});

test("热更改性能：100 个条目 unregisterByPlugin ≤16ms", () => {
  const reg = new ExtensionRegistry<{ name: string }>();
  for (let i = 0; i < 100; i++) {
    reg.register({ id: `a${i}`, pluginId: "p1", priority: i, implementation: { name: `A${i}` } });
  }
  const start = performance.now();
  reg.unregisterByPlugin("p1");
  const elapsed = performance.now() - start;
  assert.equal(reg.resolve().length, 0);
  assert.ok(elapsed < 16, `expected <16ms, got ${elapsed}ms`);
});
