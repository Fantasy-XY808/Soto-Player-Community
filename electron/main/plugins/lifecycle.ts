/**
 * 插件生命周期管理器
 *
 * 核心职责：插件禁用/卸载时，触发所有 12 Registry 的 unregisterByPlugin，
 * 实现"插件一关所有插件功能立即失效，不停留"。
 *
 * 性能要求：单插件 100 个扩展点条目时，disablePlugin 总耗时 ≤16ms。
 *
 * 注：日志直接走 console，避免引入 @main/utils/logger 的依赖链
 * （logger → config → @main/store + electron），后者无法在 tsx 测试环境中解析。
 */
import { ALL_REGISTRIES } from "../../../shared/extensions/registries";

export interface PluginLifecycleHooks {
  beforeDisable?: (pluginId: string) => Promise<void> | void;
  afterDisable?: (pluginId: string) => Promise<void> | void;
}

class PluginLifecycleManager {
  private hooks = new Map<string, PluginLifecycleHooks>();
  private disabling = new Set<string>();

  registerHooks(pluginId: string, hooks: PluginLifecycleHooks): void {
    this.hooks.set(pluginId, hooks);
  }

  unregisterHooks(pluginId: string): void {
    this.hooks.delete(pluginId);
  }

  async disablePlugin(pluginId: string): Promise<void> {
    if (this.disabling.has(pluginId)) return;
    this.disabling.add(pluginId);

    try {
      const hooks = this.hooks.get(pluginId);
      if (hooks?.beforeDisable) {
        await hooks.beforeDisable(pluginId);
      }

      const start = performance.now();
      for (const { name, registry } of ALL_REGISTRIES) {
        try {
          registry.unregisterByPlugin(pluginId);
        } catch (err) {
          console.warn(`[PluginLifecycle] Registry ${name} unregisterByPlugin failed for ${pluginId}`, err);
        }
      }
      const elapsed = performance.now() - start;
      console.debug(`[PluginLifecycle] disablePlugin ${pluginId} extensions cleared in ${elapsed}ms`);

      if (hooks?.afterDisable) {
        await hooks.afterDisable(pluginId);
      }
    } finally {
      this.disabling.delete(pluginId);
    }
  }
}

export const PluginLifecycle = new PluginLifecycleManager();
