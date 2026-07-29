<script setup lang="ts">
/**
 * AI 模型配置面板
 *
 * 列出已配置的 AI 模型，支持新增 / 编辑 / 切换激活 / 删除。
 * API Key 通过主进程 safeStorage 加密保存，前端永不接触明文。
 */
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import type {
  AiModelConfig,
  AiModelProtocol,
  AiModelSaveInput,
  AiModelState,
} from "@shared/types/settings";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucidePencil from "~icons/lucide/pencil";
import IconLucideTrash from "~icons/lucide/trash-2";
import IconLucideCheck from "~icons/lucide/check";
import IconLucideBot from "~icons/lucide/bot";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();

const state = ref<AiModelState>({ models: [], activeModelId: null });
const dialogOpen = ref(false);
const saving = ref(false);
const editingId = ref<string | null>(null);

/** 表单字段 */
const form = reactive<{
  name: string;
  protocol: AiModelProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
}>({
  name: "",
  protocol: "openai-compatible",
  baseUrl: "",
  model: "",
  apiKey: "",
});

/** 表单错误信息 */
const errors = reactive({
  name: "",
  baseUrl: "",
  model: "",
  apiKey: "",
});

/** 协议选项 */
const protocolOptions = computed(() => [
  {
    value: "openai-compatible" as const,
    label: "OpenAI Compatible",
  },
  { value: "anthropic" as const, label: "Anthropic" },
]);

/** 是否编辑模式（编辑时 apiKey 可留空表示不修改） */
const isEditing = computed(() => editingId.value !== null);

/** 重置表单 */
const resetForm = (): void => {
  form.name = "";
  form.protocol = "openai-compatible";
  form.baseUrl = "";
  form.model = "";
  form.apiKey = "";
  errors.name = "";
  errors.baseUrl = "";
  errors.model = "";
  errors.apiKey = "";
};

/** 打开新增弹窗 */
const openAdd = (): void => {
  editingId.value = null;
  resetForm();
  dialogOpen.value = true;
};

/** 打开编辑弹窗 */
const openEdit = (model: AiModelConfig): void => {
  editingId.value = model.id;
  resetForm();
  form.name = model.name;
  form.protocol = model.protocol;
  form.baseUrl = model.baseUrl;
  form.model = model.model;
  dialogOpen.value = true;
};

/** 校验表单 */
const validate = (): boolean => {
  errors.name = form.name.trim() ? "" : t("settings.aiModel.errors.nameEmpty");
  errors.baseUrl = /^https?:\/\//i.test(form.baseUrl.trim())
    ? ""
    : t("settings.aiModel.errors.urlInvalid");
  errors.model = form.model.trim() ? "" : t("settings.aiModel.errors.modelEmpty");
  // 编辑时 apiKey 留空表示沿用旧密钥
  errors.apiKey =
    isEditing.value || form.apiKey.trim() ? "" : t("settings.aiModel.errors.apiKeyEmpty");
  return !errors.name && !errors.baseUrl && !errors.model && !errors.apiKey;
};

/** 保存模型（新增或编辑） */
const save = async (): Promise<void> => {
  if (!validate() || saving.value) return;
  saving.value = true;
  try {
    const input: AiModelSaveInput = {
      id: editingId.value ?? undefined,
      name: form.name.trim(),
      protocol: form.protocol,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim() || undefined,
    };
    state.value = await window.api.ai.saveModel(input);
    dialogOpen.value = false;
    toast.success(t(isEditing.value ? "settings.aiModel.updated" : "settings.aiModel.added"));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
};

/** 删除模型 */
const remove = async (model: AiModelConfig): Promise<void> => {
  const ok = await dialog.confirm({
    title: t("settings.aiModel.deleteConfirmTitle"),
    content: t("settings.aiModel.deleteConfirm", { name: model.name }),
    type: "warning",
  });
  if (!ok) return;
  try {
    state.value = await window.api.ai.removeModel(model.id);
    toast.success(t("settings.aiModel.removed"));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
};

/** 切换激活的模型 */
const activate = async (model: AiModelConfig): Promise<void> => {
  // 已激活时点击切换为关闭
  const nextId = state.value.activeModelId === model.id ? null : model.id;
  try {
    state.value = await window.api.ai.setActiveModel(nextId);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
};

/** 刷新模型列表 */
const refresh = async (): Promise<void> => {
  state.value = await window.api.ai.listModels();
};

onMounted(refresh);
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 提示卡片 -->
    <div
      class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3"
    >
      <div class="text-sm font-medium text-on-surface">{{ t("settings.aiModel.hint") }}</div>
      <div class="mt-1 text-xs text-on-surface-variant/70">
        {{ t("settings.aiModel.hintDetail") }}
      </div>
    </div>

    <!-- 模型列表 -->
    <div v-if="state.models.length === 0" class="rounded-xl bg-on-surface/4 px-4 py-8 text-center">
      <IconLucideBot class="mx-auto size-8 text-on-surface-variant/40" />
      <div class="mt-2 text-sm text-on-surface-variant/70">
        {{ t("settings.aiModel.empty") }}
      </div>
      <div class="mt-0.5 text-xs text-on-surface-variant/50">
        {{ t("settings.aiModel.emptyHint") }}
      </div>
    </div>

    <div v-else class="flex flex-col gap-2">
      <button
        v-for="model in state.models"
        :key="model.id"
        type="button"
        class="flex items-center gap-3 rounded-xl bg-surface-panel border border-solid px-4 py-3 text-left transition-colors"
        :class="
          state.activeModelId === model.id
            ? 'border-primary/40 bg-primary/5'
            : 'border-outline-variant/15 hover:border-outline-variant/30'
        "
        @click="activate(model)"
      >
        <div
          class="size-9 rounded-lg bg-on-surface/6 flex items-center justify-center text-on-surface-variant shrink-0"
        >
          <IconLucideBot class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-on-surface truncate">{{ model.name }}</span>
            <STag v-if="state.activeModelId === model.id" size="small" type="success" variant="soft">
              <IconLucideCheck class="size-3" />
              {{ t("settings.aiModel.activated") }}
            </STag>
          </div>
          <div class="mt-0.5 truncate text-xs text-on-surface-variant/60">
            {{ model.model }} · {{ model.baseUrl }}
          </div>
          <div class="mt-0.5 text-xs text-on-surface-variant/50">
            {{ protocolOptions.find((opt) => opt.value === model.protocol)?.label }}
            <span v-if="model.hasApiKey" class="ml-1">· {{ t("settings.aiModel.apiKey") }}</span>
          </div>
        </div>
        <div class="shrink-0 flex items-center gap-1" @click.stop>
          <SButton variant="ghost" circle size="tiny" @click="openEdit(model)">
            <template #icon><IconLucidePencil /></template>
          </SButton>
          <SButton variant="ghost" circle size="tiny" type="error" @click="remove(model)">
            <template #icon><IconLucideTrash /></template>
          </SButton>
        </div>
      </button>
    </div>

    <!-- 添加按钮 -->
    <SButton variant="secondary" type="primary" block @click="openAdd">
      <template #icon><IconLucidePlus /></template>
      {{ t("settings.aiModel.add") }}
    </SButton>

    <!-- 新增 / 编辑弹窗 -->
    <SDialog
      v-model:open="dialogOpen"
      :title="t(isEditing ? 'settings.aiModel.editModel' : 'settings.aiModel.add')"
      width="min(480px, calc(100vw - 32px))"
    >
      <div class="flex flex-col gap-3">
        <!-- 协议 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs text-on-surface-variant">
            {{ t("settings.aiModel.protocol") }}
          </label>
          <SSelect v-model="form.protocol" :options="protocolOptions" />
        </div>

        <!-- 名称 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs text-on-surface-variant">
            {{ t("settings.aiModel.name") }}
          </label>
          <SInput
            v-model="form.name"
            :placeholder="t('settings.aiModel.namePlaceholder')"
            :status="errors.name ? 'error' : 'default'"
          />
          <span v-if="errors.name" class="text-xs text-error">{{ errors.name }}</span>
        </div>

        <!-- API 地址 -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs text-on-surface-variant">
            {{ t("settings.aiModel.baseUrl") }}
          </label>
          <SInput
            v-model="form.baseUrl"
            placeholder="https://api.example.com/v1"
            :status="errors.baseUrl ? 'error' : 'default'"
          />
          <span v-if="errors.baseUrl" class="text-xs text-error">{{ errors.baseUrl }}</span>
        </div>

        <!-- 模型 ID -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs text-on-surface-variant">
            {{ t("settings.aiModel.model") }}
          </label>
          <SInput
            v-model="form.model"
            placeholder="gpt-4o / claude-3-5-sonnet"
            :status="errors.model ? 'error' : 'default'"
          />
          <span v-if="errors.model" class="text-xs text-error">{{ errors.model }}</span>
        </div>

        <!-- API Key -->
        <div class="flex flex-col gap-1.5">
          <label class="text-xs text-on-surface-variant">
            {{ t("settings.aiModel.apiKey") }}
          </label>
          <SInput
            v-model="form.apiKey"
            type="password"
            :placeholder="
              isEditing
                ? t('settings.aiModel.apiKeySavedPlaceholder')
                : t('settings.aiModel.apiKeyPlaceholder')
            "
            :status="errors.apiKey ? 'error' : 'default'"
          />
          <span v-if="errors.apiKey" class="text-xs text-error">{{ errors.apiKey }}</span>
        </div>
      </div>

      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton variant="secondary" type="primary" :loading="saving" @click="save">
          {{ t("common.save") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
