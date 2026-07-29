import type { Disposable } from "./disposable";
import { disposable } from "./disposable";

/** 扩展点条目描述符 */
export interface ExtensionDescriptor<T> {
  /** 条目唯一 ID（如 "lyricsCard.vinyl"） */
  id: string;
  /** 注册该条目的插件 ID（如 "soto.builtin" 或 "user.myplugin"） */
  pluginId: string;
  /** resolve 时按降序排列，同优先级按注册顺序 */
  priority: number;
  /** 实际实现 */
  implementation: T;
  /** 可选元数据（用于扩展点查看面板） */
  metadata?: Record<string, unknown>;
}

/**
 * 通用扩展点注册中心
 *
 * - register 返回 Disposable，调用后自动注销
 * - unregisterByPlugin 用于热更改：插件关闭时批量注销该插件的所有条目
 * - subscribe 监听 version 变化，用于渲染端 reactive 触发
 *
 * 性能要求：100 个条目 unregisterByPlugin ≤16ms（一帧内）
 */
export class ExtensionRegistry<T> {
  private readonly descriptors = new Map<string, ExtensionDescriptor<T>>();
  private readonly pluginIndex = new Map<string, Set<string>>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  register(descriptor: ExtensionDescriptor<T>): Disposable {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(`Extension already registered: ${descriptor.id}`);
    }
    this.descriptors.set(descriptor.id, descriptor);

    let set = this.pluginIndex.get(descriptor.pluginId);
    if (!set) {
      set = new Set();
      this.pluginIndex.set(descriptor.pluginId, set);
    }
    set.add(descriptor.id);

    this.bump();

    const reg = this;
    let disposed = false;
    return disposable(() => {
      if (disposed) return;
      disposed = true;
      reg.unregister(descriptor.id);
    });
  }

  unregister(extensionId: string): void {
    const desc = this.descriptors.get(extensionId);
    if (!desc) return;
    this.descriptors.delete(extensionId);
    const set = this.pluginIndex.get(desc.pluginId);
    if (set) {
      set.delete(extensionId);
      if (set.size === 0) this.pluginIndex.delete(desc.pluginId);
    }
    this.bump();
  }

  /** 热更改核心：批量注销某插件的所有条目 */
  unregisterByPlugin(pluginId: string): void {
    const set = this.pluginIndex.get(pluginId);
    if (!set || set.size === 0) return;
    for (const id of set) {
      this.descriptors.delete(id);
    }
    this.pluginIndex.delete(pluginId);
    this.bump();
  }

  /** 按优先级降序返回所有实现 */
  resolve(): T[] {
    const list = Array.from(this.descriptors.values());
    list.sort((a, b) => b.priority - a.priority);
    return list.map((d) => d.implementation);
  }

  resolveById(id: string): T | undefined {
    return this.descriptors.get(id)?.implementation;
  }

  resolveDescriptor(id: string): ExtensionDescriptor<T> | undefined {
    return this.descriptors.get(id);
  }

  listDescriptors(): ExtensionDescriptor<T>[] {
    return Array.from(this.descriptors.values());
  }

  subscribe(listener: () => void): Disposable {
    this.listeners.add(listener);
    const reg = this;
    return disposable(() => { reg.listeners.delete(listener); });
  }

  getVersion(): number {
    return this.version;
  }

  private bump(): void {
    this.version++;
    for (const listener of this.listeners) {
      try { listener(); } catch { /* 单个监听器异常不影响其他 */ }
    }
  }
}
