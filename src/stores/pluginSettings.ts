/**
 * 插件设置项管理
 *
 * 插件通过 registerSetting 注册自定义设置项，设置项会出现在设置页面的插件区域。
 * 设置 key 格式：plugin.<pluginId>.<settingKey>
 */

export type PluginSettingType = "boolean" | "number" | "string" | "select";

export interface PluginSettingDefinition {
  pluginId: string;
  key: string;
  type: PluginSettingType;
  defaultValue: unknown;
  label?: string;
  description?: string;
  options?: { label: string; value: unknown }[];
  min?: number;
  max?: number;
  step?: number;
}

/** 构建设置项的完整 key */
export const buildPluginSettingsKey = (pluginId: string, key: string): string => {
  return `plugin.${pluginId}.${key}`;
};

/** 判断该设置项是否已注册 */
export const isPluginSettingRegistered = (
  registry: Map<string, PluginSettingDefinition>,
  pluginId: string,
  key: string,
): boolean => {
  return registry.has(buildPluginSettingsKey(pluginId, key));
};

/** 获取设置项默认值 */
export const getPluginSettingDefault = (
  registry: Map<string, PluginSettingDefinition>,
  pluginId: string,
  key: string,
): unknown => {
  return registry.get(buildPluginSettingsKey(pluginId, key))?.defaultValue;
};

/**
 * 插件设置注册中心（运行时单例）
 */
class PluginSettingsRegistry {
  private definitions = new Map<string, PluginSettingDefinition>();

  register(def: PluginSettingDefinition): void {
    const fullKey = buildPluginSettingsKey(def.pluginId, def.key);
    this.definitions.set(fullKey, def);
  }

  unregister(pluginId: string): void {
    for (const [key, def] of this.definitions) {
      if (def.pluginId === pluginId) {
        this.definitions.delete(key);
      }
    }
  }

  get(pluginId: string, key: string): PluginSettingDefinition | undefined {
    return this.definitions.get(buildPluginSettingsKey(pluginId, key));
  }

  listByPlugin(pluginId: string): PluginSettingDefinition[] {
    const result: PluginSettingDefinition[] = [];
    for (const def of this.definitions.values()) {
      if (def.pluginId === pluginId) result.push(def);
    }
    return result;
  }

  listAll(): PluginSettingDefinition[] {
    return Array.from(this.definitions.values());
  }

  clear(): void {
    this.definitions.clear();
  }

  get size(): number {
    return this.definitions.size;
  }
}

export const pluginSettingsRegistry = new PluginSettingsRegistry();
