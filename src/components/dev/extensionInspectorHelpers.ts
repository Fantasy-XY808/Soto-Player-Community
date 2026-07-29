/**
 * 扩展点查看面板辅助函数
 *
 * 将扩展点查看面板中可测试的纯逻辑从 Vue 组件中拆出：
 * - buildRegistryGroups：从 ALL_REGISTRIES 构建 12 个分组
 * - buildDescriptorRows：将 ExtensionDescriptor[] 转为面板行数据
 * - filterByKeyword：按 id / pluginId / metadata 值过滤
 * - formatPriority：优先级展示格式化
 */
// 注：使用相对路径而非 @shared/* 别名，以便 tsx --test 直接解析
// （参考 electron/main/services/cue.ts 的同样处理）
import { ALL_REGISTRIES } from "../../../shared/extensions/registries";
import type { ExtensionRegistry } from "../../../shared/extensions/registry";

export interface RegistryGroup {
  name: string;
  registry: ExtensionRegistry<unknown>;
}

export interface DescriptorRow {
  id: string;
  pluginId: string;
  priority: number;
  hasMetadata: boolean;
  metadata?: Record<string, unknown>;
}

/** 构建 12 个 Registry 分组 */
export const buildRegistryGroups = (): RegistryGroup[] => {
  return ALL_REGISTRIES.map((g) => ({
    name: g.name,
    registry: g.registry,
  }));
};

/** 从描述符列表构建行数据 */
export const buildDescriptorRows = (
  descriptors: {
    id: string;
    pluginId: string;
    priority: number;
    implementation: unknown;
    metadata?: Record<string, unknown>;
  }[],
): DescriptorRow[] => {
  return descriptors.map((d) => ({
    id: d.id,
    pluginId: d.pluginId,
    priority: d.priority,
    hasMetadata: Boolean(d.metadata) && Object.keys(d.metadata ?? {}).length > 0,
    metadata: d.metadata,
  }));
};

/** 按关键字过滤行（匹配 id / pluginId / metadata 值） */
export const filterByKeyword = (rows: DescriptorRow[], keyword: string): DescriptorRow[] => {
  const trimmed = keyword.trim().toLowerCase();
  if (!trimmed) return rows;

  return rows.filter((row) => {
    if (row.id.toLowerCase().includes(trimmed)) return true;
    if (row.pluginId.toLowerCase().includes(trimmed)) return true;
    if (row.metadata) {
      for (const value of Object.values(row.metadata)) {
        if (String(value).toLowerCase().includes(trimmed)) return true;
      }
    }
    return false;
  });
};

/** 格式化优先级显示 */
export const formatPriority = (priority: number): string => {
  return String(priority);
};
