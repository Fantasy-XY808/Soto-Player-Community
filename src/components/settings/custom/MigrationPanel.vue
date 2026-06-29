<script setup lang="ts">
/**
 * 设置面板：从 SPlayer-Next 迁移数据
 *
 * 流程：
 *   1. 检测旧数据是否存在；不存在则按钮禁用 + 提示「无可迁移数据」
 *   2. 点击「开始迁移」打开确认弹窗，提示「当前已设置的选项会被覆盖」
 *   3. 弹窗显示 3s 倒计时，倒计时结束前确认按钮禁用且显示秒数
 *   4. 确认后执行迁移，成功后提示用户重启应用
 */

import { computed, onBeforeUnmount, ref, watch } from "vue";
import IconArrowRightLeft from "~icons/lucide/arrow-right-left";
import IconAlertTriangle from "~icons/lucide/alert-triangle";
import { toast } from "@/composables/useToast";

const { t } = useI18n();

/** 旧数据是否存在 */
const hasLegacy = ref<boolean | null>(null);
/** 确认弹窗打开 */
const confirmOpen = ref(false);
/** 倒计时剩余秒数（0 表示可点击） */
const countdown = ref(0);
/** 迁移中 */
const migrating = ref(false);
/** 迁移结果（成功） */
const succeeded = ref(false);
/** 迁移错误 */
const errorMsg = ref("");

/** 倒计时定时器 */
let timer: ReturnType<typeof setInterval> | null = null;

/** 确认按钮是否可点击 */
const canConfirm = computed(() => countdown.value === 0 && !migrating.value);

/** 检测旧数据 */
const detect = async (): Promise<void> => {
  try {
    hasLegacy.value = await window.api.migration.hasLegacyData();
  } catch {
    hasLegacy.value = false;
  }
};

detect();

/** 打开确认弹窗并启动倒计时 */
const openConfirm = (): void => {
  confirmOpen.value = true;
  countdown.value = 3;
  errorMsg.value = "";
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0) {
      countdown.value = 0;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }
  }, 1000);
};

/** 关闭确认弹窗 */
const closeConfirm = (): void => {
  confirmOpen.value = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
};

/** 执行迁移 */
const onConfirm = async (): Promise<void> => {
  if (!canConfirm.value) return;
  migrating.value = true;
  errorMsg.value = "";
  try {
    const result = await window.api.migration.perform();
    if (result.ok) {
      succeeded.value = true;
      closeConfirm();
      toast.success(t("settings.migration.success"));
    } else {
      errorMsg.value = result.error ?? t("settings.migration.failed");
      toast.error(t("settings.migration.failed"));
    }
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err);
    toast.error(t("settings.migration.failed"));
  } finally {
    migrating.value = false;
  }
};

/** 确认按钮文案：倒计时中显示秒数，否则显示"确认迁移" */
const confirmLabel = computed(() => {
  if (migrating.value) return t("settings.migration.migrating");
  if (countdown.value > 0) return t("settings.migration.confirmCountdown", { n: countdown.value });
  return t("settings.migration.confirm");
});

watch(confirmOpen, (open) => {
  if (!open && timer) {
    clearInterval(timer);
    timer = null;
  }
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-start gap-3">
      <div
        class="shrink-0 size-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"
      >
        <IconArrowRightLeft class="size-5" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium">{{ t("settings.migration.title") }}</div>
        <div class="text-xs text-on-surface-variant/70 mt-1 leading-relaxed">
          {{ t("settings.migration.description") }}
        </div>
        <div v-if="hasLegacy === false" class="text-xs text-on-surface-variant/50 mt-2">
          {{ t("settings.migration.noLegacy") }}
        </div>
        <div v-else-if="succeeded" class="text-xs text-primary mt-2">
          {{ t("settings.migration.successHint") }}
        </div>
        <div v-else-if="errorMsg" class="text-xs text-error mt-2">{{ errorMsg }}</div>
      </div>
      <SButton type="primary" size="small" :disabled="!hasLegacy || succeeded" @click="openConfirm">
        {{ t("settings.migration.start") }}
      </SButton>
    </div>

    <!-- 确认弹窗 -->
    <SDialog
      v-model:open="confirmOpen"
      :title="t('settings.migration.confirmTitle')"
      width="420"
    >
      <div class="flex flex-col gap-3 py-2">
        <div class="flex items-start gap-3">
          <IconAlertTriangle class="size-5 text-warning shrink-0 mt-0.5" />
          <div class="flex-1 text-sm leading-relaxed">
            {{ t("settings.migration.confirmWarning") }}
          </div>
        </div>
        <div class="text-xs text-on-surface-variant/70 leading-relaxed">
          {{ t("settings.migration.confirmScope") }}
        </div>
        <div v-if="errorMsg" class="text-xs text-error">{{ errorMsg }}</div>
      </div>
      <template #footer>
        <SButton variant="ghost" round @click="closeConfirm">
          {{ t("common.cancel") }}
        </SButton>
        <SButton
          type="primary"
          round
          :loading="migrating"
          :disabled="!canConfirm"
          @click="onConfirm"
        >
          {{ confirmLabel }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
