<script setup lang="ts">
/**
 * 扩展点查看面板
 *
 * 调试用：列出 12 个 Registry 中当前注册的所有扩展点条目，支持关键字过滤。
 * 用于排查插件注册是否成功。
 */
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  buildRegistryGroups,
  buildDescriptorRows,
  filterByKeyword,
  formatPriority,
  type DescriptorRow,
  type RegistryGroup,
} from "./extensionInspectorHelpers";

const { t } = useI18n();
const keyword = ref("");
const groups = buildRegistryGroups();

/** 默认展开前 3 个分组 */
const expandedNames = ref<Set<string>>(
  new Set(groups.slice(0, 3).map((g) => g.name)),
);

const toggleGroup = (name: string): void => {
  if (expandedNames.value.has(name)) {
    expandedNames.value.delete(name);
  } else {
    expandedNames.value.add(name);
  }
};

const getFilteredRows = (group: RegistryGroup): DescriptorRow[] => {
  const descriptors = group.registry.listDescriptors();
  const rows = buildDescriptorRows(descriptors);
  return filterByKeyword(rows, keyword.value);
};

const getRowCount = (group: RegistryGroup): number => {
  return group.registry.listDescriptors().length;
};

/** 是否有任何分组匹配关键字（用于空态展示） */
const hasAnyMatch = computed(() => {
  return groups.some((g) => getFilteredRows(g).length > 0);
});

/** 总扩展点数（用于头部统计） */
const totalCount = computed(() => groups.reduce((sum, g) => sum + getRowCount(g), 0));
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- 头部：标题 + 搜索框 -->
    <section>
      <h3
        class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1"
      >
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("dev.extensionInspector.title") }}
        <STag type="primary" size="small" round>{{ totalCount }}</STag>
      </h3>
      <div
        class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4"
      >
        <SInput
          v-model="keyword"
          :placeholder="t('dev.extensionInspector.searchPlaceholder')"
          size="small"
          clearable
          class="w-full"
        />
      </div>
    </section>

    <!-- 分组列表 -->
    <section>
      <div class="flex flex-col gap-2.5">
        <div
          v-for="group in groups"
          :key="group.name"
          class="rounded-xl border border-solid border-outline-variant/15 bg-surface-panel overflow-hidden transition-colors hover:border-outline-variant/30"
        >
          <!-- 分组标题（可点击展开/收起） -->
          <button
            type="button"
            class="flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-on-surface/4 transition-colors"
            @click="toggleGroup(group.name)"
          >
            <IconLucideChevronRight
              class="size-4 shrink-0 text-on-surface-variant transition-transform duration-200"
              :class="{ 'rotate-90': expandedNames.has(group.name) }"
            />
            <span class="text-sm font-medium text-on-surface flex-1 truncate">
              {{ t(`dev.extensionInspector.group.${group.name}`, group.name) }}
            </span>
            <STag type="info" variant="soft" size="small" round>
              {{ getRowCount(group) }}
            </STag>
          </button>

          <!-- 分组内容（展开时显示） -->
          <div
            v-if="expandedNames.has(group.name)"
            class="border-t border-solid border-outline-variant/10"
          >
            <table
              v-if="getFilteredRows(group).length > 0"
              class="w-full text-xs border-collapse"
            >
              <thead class="bg-on-surface/4 text-on-surface-variant">
                <tr>
                  <th class="px-3 py-2 text-left font-medium">
                    {{ t("dev.extensionInspector.colId") }}
                  </th>
                  <th class="px-3 py-2 text-left font-medium">
                    {{ t("dev.extensionInspector.colPlugin") }}
                  </th>
                  <th class="px-3 py-2 text-right font-medium w-20">
                    {{ t("dev.extensionInspector.colPriority") }}
                  </th>
                  <th class="px-3 py-2 text-center font-medium w-20">
                    {{ t("dev.extensionInspector.colMetadata") }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in getFilteredRows(group)"
                  :key="row.id"
                  class="border-t border-solid border-outline-variant/8 hover:bg-on-surface/4 transition-colors"
                >
                  <td class="px-3 py-2 text-on-surface break-all">{{ row.id }}</td>
                  <td class="px-3 py-2 text-on-surface-variant break-all">
                    {{ row.pluginId }}
                  </td>
                  <td
                    class="px-3 py-2 text-right text-on-surface-variant tabular-nums"
                  >
                    {{ formatPriority(row.priority) }}
                  </td>
                  <td class="px-3 py-2 text-center">
                    <span v-if="row.hasMetadata" class="text-primary">✓</span>
                    <span v-else class="text-on-surface-variant/40">—</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div
              v-else
              class="px-3 py-6 text-center text-xs text-on-surface-variant/60"
            >
              {{ t("dev.extensionInspector.noMatch") }}
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 全局空态 -->
    <div
      v-if="!hasAnyMatch"
      class="px-3 py-8 text-center text-xs text-on-surface-variant/60 rounded-xl border border-dashed border-outline-variant/20"
    >
      {{ t("dev.extensionInspector.noMatch") }}
    </div>
  </div>
</template>
