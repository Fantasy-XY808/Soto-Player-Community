<script setup lang="ts">
/**
 * MCP 客户端配置弹窗
 *
 * 展示 MCP 服务端点 + X-MCP-Key，并探测本地已安装的 AI Agent，
 * 允许用户一键把 soto-player 的 MCP 配置注入到 Agent 配置文件中。
 *
 * 注入逻辑由主进程 injector.ts 完成；此处仅负责交互与状态展示。
 */
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";
import type { McpAgentApp, McpClientConfigParams } from "@shared/types/settings";
import IconLucideCopy from "~icons/lucide/copy";
import IconLucideRefresh from "~icons/lucide/refresh-cw";
import IconLucideCheck from "~icons/lucide/check";
import IconLucidePlug from "~icons/lucide/plug";
import IconLucideTrash from "~icons/lucide/trash-2";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const { copy } = useCopyText();

const open = ref(false);
const detecting = ref(false);
const injectingId = ref<string | null>(null);
const removingId = ref<string | null>(null);
const agents = ref<McpAgentApp[]>([]);
const params = ref<McpClientConfigParams | null>(null);

/** MCP 服务端点（监听中才有意义） */
const endpoint = computed(() =>
  params.value ? `http://127.0.0.1:${params.value.port}/mcp` : "",
);

/** 重新拉取探测结果与配置参数 */
const refresh = async (): Promise<void> => {
  detecting.value = true;
  try {
    const [detected, clientParams] = await Promise.all([
      window.api.mcp.detectAgents(),
      window.api.mcp.getClientConfigParams(),
    ]);
    agents.value = detected;
    params.value = clientParams;
  } finally {
    detecting.value = false;
  }
};

/** 打开弹窗时拉取一次 */
watch(open, (value) => {
  if (value) void refresh();
});

/** 注入 MCP 配置到指定 Agent */
const inject = async (agent: McpAgentApp): Promise<void> => {
  if (!params.value || injectingId.value) return;
  injectingId.value = agent.id;
  try {
    const ok = await window.api.mcp.injectAgentConfig(agent.id, params.value);
    if (ok) {
      toast.success(t("settings.mcp.injectSuccess"));
      await refresh();
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    injectingId.value = null;
  }
};

/** 从 Agent 配置中移除 soto-player 条目 */
const remove = async (agent: McpAgentApp): Promise<void> => {
  if (removingId.value) return;
  removingId.value = agent.id;
  try {
    const ok = await window.api.mcp.removeAgentConfig(agent.id);
    if (ok) {
      toast.success(t("settings.mcp.removeSuccess"));
      await refresh();
    }
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    removingId.value = null;
  }
};
</script>

<template>
  <SButton variant="secondary" size="small" @click="open = true">
    <template #icon><IconLucidePlug /></template>
    {{ t("settings.mcp.configDetails") }}
  </SButton>

  <SDialog
    v-model:open="open"
    :title="t('settings.mcp.configDetails')"
    width="min(560px, calc(100vw - 32px))"
  >
    <div class="flex flex-col gap-4">
      <!-- 服务端点 + 密钥 -->
      <div class="flex flex-col gap-2 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3">
        <div class="flex items-center gap-2">
          <span class="text-xs text-on-surface-variant/60 w-16 shrink-0">
            {{ t("settings.mcp.endpoint") }}
          </span>
          <div class="min-w-0 flex-1 truncate text-sm text-on-surface tabular-nums">
            {{ endpoint || t("settings.mcp.stopped") }}
          </div>
          <SButton
            v-if="endpoint"
            variant="ghost"
            circle
            size="tiny"
            @click="copy(endpoint)"
          >
            <template #icon><IconLucideCopy /></template>
          </SButton>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-on-surface-variant/60 w-16 shrink-0">X-MCP-Key</span>
          <div class="min-w-0 flex-1 truncate text-sm text-on-surface-variant tabular-nums">
            {{ params?.accessKey ?? "—" }}
          </div>
          <SButton
            v-if="params?.accessKey"
            variant="ghost"
            circle
            size="tiny"
            @click="copy(params.accessKey)"
          >
            <template #icon><IconLucideCopy /></template>
          </SButton>
        </div>
      </div>

      <!-- Agent 列表 -->
      <div class="flex items-center justify-between">
        <div class="text-sm text-on-surface-variant">
          {{ t("settings.mcp.detectHint") }}
        </div>
        <SButton variant="ghost" size="small" :loading="detecting" @click="refresh">
          <template #icon><IconLucideRefresh /></template>
          {{ t("common.refresh") }}
        </SButton>
      </div>

      <div v-if="agents.length === 0" class="py-6 text-center text-sm text-on-surface-variant/50">
        {{ detecting ? t("common.loading") : t("settings.mcp.agentsEmpty") }}
      </div>

      <div v-else class="flex flex-col gap-2">
        <div
          v-for="agent in agents"
          :key="agent.id"
          class="flex items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-on-surface">{{ agent.name }}</span>
              <STag v-if="agent.configured" size="small" type="success" variant="soft">
                <IconLucideCheck class="size-3" />
                {{ t("settings.mcp.injected") }}
              </STag>
              <STag v-if="!agent.injectable" size="small" type="warning" variant="soft">
                {{ t("settings.mcp.notSupported") }}
              </STag>
            </div>
            <div class="mt-0.5 truncate text-xs text-on-surface-variant/60">
              {{ agent.configPath }}
            </div>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <SButton
              v-if="agent.configured"
              variant="ghost"
              size="small"
              type="error"
              :loading="removingId === agent.id"
              @click="remove(agent)"
            >
              <template #icon><IconLucideTrash /></template>
              {{ t("settings.mcp.remove") }}
            </SButton>
            <SButton
              v-else
              variant="secondary"
              size="small"
              type="primary"
              :disabled="!agent.injectable"
              :loading="injectingId === agent.id"
              @click="inject(agent)"
            >
              {{ t("settings.mcp.inject") }}
            </SButton>
          </div>
        </div>
      </div>
    </div>
  </SDialog>
</template>
