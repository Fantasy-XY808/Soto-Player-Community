<script setup lang="ts">
import { useDialog, type DialogType } from "@/composables/useDialog";

const { t } = useI18n();
const { dialogs, settle } = useDialog();

/** DialogType 到 SButton type 的映射：default 走默认按钮色，其他透传 */
const resolveButtonType = (
  type?: DialogType,
): "default" | "info" | "success" | "warning" | "error" => {
  if (!type || type === "default") return "default";
  return type;
};

/** v-model:open 变 false 时视为点击关闭按钮 / 遮罩 / Esc，统一 resolve false */
const handleOpenUpdate = (id: number, value: boolean): void => {
  if (!value) settle(id, false);
};
</script>

<template>
  <SDialog
    v-for="item in dialogs"
    :key="item.id"
    :open="item.open.value"
    :title="item.options.title"
    :description="item.options.description"
    :closable="item.options.closable ?? true"
    width="420px"
    @update:open="(value: boolean) => handleOpenUpdate(item.id, value)"
  >
    <component :is="item.options.body" v-if="item.options.body" />
    <p
      v-else-if="item.options.content"
      class="text-sm text-on-surface-variant m-0 whitespace-pre-line"
    >
      {{ item.options.content }}
    </p>

    <template #footer>
      <SButton v-if="item.kind === 'confirm'" variant="secondary" @click="settle(item.id, false)">
        {{ item.options.cancelText ?? t("common.cancel") }}
      </SButton>
      <SButton :type="resolveButtonType(item.options.type)" @click="settle(item.id, true)">
        {{ item.options.confirmText ?? t("common.confirm") }}
      </SButton>
    </template>
  </SDialog>
</template>
