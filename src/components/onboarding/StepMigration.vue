<script setup lang="ts">
/**
 * 数据迁移引导步骤
 *
 * 检测旧 SPlayer-Next 数据是否存在：
 *   - 存在：显示迁移选项，用户可选择迁移或跳过
 *   - 不存在：自动 emit('next')，跳过此步
 */

import { onMounted, ref } from "vue";
import IconDatabase from "~icons/lucide/database";
import IconChevronLeft from "~icons/lucide/chevron-left";
import IconCheck from "~icons/lucide/check";
import IconAlertTriangle from "~icons/lucide/alert-triangle";
import { toast } from "@/composables/useToast";

const { t } = useI18n();
const emit = defineEmits<{ (e: "next"): void; (e: "back"): void }>();

/** 是否检测到旧数据 */
const hasLegacy = ref(false);
/** 检测中 */
const detecting = ref(true);
/** 迁移中 */
const migrating = ref(false);
/** 迁移是否完成（用于显示完成提示） */
const done = ref(false);
/** 迁移错误信息 */
const errorMsg = ref("");

onMounted(async () => {
  try {
    hasLegacy.value = await window.api.migration.hasLegacyData();
    if (!hasLegacy.value) {
      // 无旧数据时自动跳过此步
      emit("next");
      return;
    }
  } catch (err) {
    console.warn("[StepMigration] detect failed:", err);
    emit("next");
    return;
  }
  detecting.value = false;
});

/** 执行迁移 */
const onMigrate = async (): Promise<void> => {
  if (migrating.value) return;
  migrating.value = true;
  errorMsg.value = "";
  try {
    const result = await window.api.migration.perform();
    if (result.ok) {
      done.value = true;
      toast.success(t("onboarding.migration.success"));
    } else {
      errorMsg.value = result.error ?? t("onboarding.migration.failed");
      toast.error(t("onboarding.migration.failed"));
    }
  } catch (err) {
    console.warn("[StepMigration] migrate failed:", err);
    errorMsg.value = err instanceof Error ? err.message : String(err);
    toast.error(t("onboarding.migration.failed"));
  } finally {
    migrating.value = false;
  }
};
</script>

<template>
  <div v-if="!detecting" class="flex flex-col max-w-2xl w-full mx-auto">
    <div class="flex items-center gap-3 mb-2">
      <IconDatabase class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.migration.title") }}</h2>
    </div>
    <p class="text-on-surface-variant/70 mb-6 leading-relaxed">
      {{ t("onboarding.migration.subtitle") }}
    </p>

    <!-- 迁移完成态 -->
    <div
      v-if="done"
      class="bg-primary/8 border border-solid border-primary/20 rounded-xl p-5 mb-4 flex items-start gap-3"
    >
      <IconCheck class="size-5 text-primary shrink-0 mt-0.5" />
      <div class="flex-1">
        <div class="font-medium mb-1">{{ t("onboarding.migration.successTitle") }}</div>
        <div class="text-sm text-on-surface-variant/80">
          {{ t("onboarding.migration.successHint") }}
        </div>
      </div>
    </div>

    <!-- 默认迁移介绍 -->
    <div v-else class="bg-on-surface/4 border border-solid border-primary/10 rounded-xl p-5 mb-4">
      <div class="flex items-start gap-3 mb-3">
        <IconAlertTriangle class="size-5 text-warning shrink-0 mt-0.5" />
        <div class="flex-1 text-sm leading-relaxed">
          {{ t("onboarding.migration.warning") }}
        </div>
      </div>
      <div class="flex flex-col gap-2 mt-3">
        <div class="flex items-center gap-2 text-sm">
          <IconCheck class="size-4 text-primary shrink-0" />
          <span>{{ t("onboarding.migration.itemConfig") }}</span>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <IconCheck class="size-4 text-primary shrink-0" />
          <span>{{ t("onboarding.migration.itemDatabase") }}</span>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <IconCheck class="size-4 text-primary shrink-0" />
          <span>{{ t("onboarding.migration.itemCache") }}</span>
        </div>
        <div class="flex items-center gap-2 text-sm">
          <IconCheck class="size-4 text-primary shrink-0" />
          <span>{{ t("onboarding.migration.itemPlugins") }}</span>
        </div>
      </div>
    </div>

    <!-- 错误提示 -->
    <SAlert v-if="errorMsg" type="error" class="mb-4">{{ errorMsg }}</SAlert>

    <div class="flex items-center gap-3">
      <SButton variant="ghost" round :disabled="migrating" @click="$emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton v-if="!done" variant="ghost" round :disabled="migrating" @click="$emit('next')">
        {{ t("onboarding.migration.skip") }}
      </SButton>
      <SButton v-if="!done" type="primary" round :loading="migrating" @click="onMigrate">
        {{ t("onboarding.migration.migrate") }}
      </SButton>
      <SButton v-else type="primary" round @click="$emit('next')">
        {{ t("onboarding.next") }}
      </SButton>
    </div>
  </div>
</template>
