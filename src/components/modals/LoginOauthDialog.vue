<script setup lang="ts">
/**
 * Tidal OAuth 登录弹窗
 *
 * 与 LoginTokenDialog 之不同：
 * - 不需要用户手动输入 token，而是 OAuth + PKCE 浏览器跳转授权
 * - 流程：点击「开始授权」→ 主进程启动 callback server + 返回 authorizeUrl
 *        → 渲染端 window.open(authorizeUrl) 打开浏览器
 *        → 用户在浏览器登录 Tidal 并授权
 *        → Tidal 重定向到 localhost:1419/callback?code=xxx&state=yyy
 *        → 主进程 callback server 收到 code，交换 token 并落盘
 *        → completeOauth 返回 profile，弹窗关闭
 *
 * 用户可随时取消：点击「取消」会调 cancelOauth 清理 callback server，
 * 等待中的 completeOauth Promise 会被主动 reject。
 */

import { toast } from "@/composables/useToast";

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 登录成功 */
  success: [];
}>();

const { t } = useI18n();

/** 流程阶段：idle（未开始）/ waiting（已打开浏览器，等待 callback）/ done */
type Stage = "idle" | "waiting" | "done";
const stage = ref<Stage>("idle");
const loading = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      // 弹窗关闭时若仍在等待 callback，主动取消清理 server
      if (stage.value === "waiting") {
        void window.api.tidal.cancelOauth();
      }
      stage.value = "idle";
      loading.value = false;
    }
  },
);

/** 点击「开始授权」按钮 */
const startAuth = async (): Promise<void> => {
  loading.value = true;
  try {
    const { authorizeUrl } = await window.api.tidal.startOauth();
    // 在系统默认浏览器中打开授权 URL（Electron 的 window.open 会创建新窗口，
    // 但 Tidal 授权页更合适在浏览器中完成，含已登录态复用）
    window.open(authorizeUrl, "_blank", "noopener,noreferrer");
    stage.value = "waiting";
  } catch (err) {
    toast.error(t("login.tidalOauthStartFailed", { error: err instanceof Error ? err.message : String(err) }));
    loading.value = false;
  }
};

/** 点击「我已完成授权」按钮：调用 completeOauth 等待并交换 token */
const completeAuth = async (): Promise<void> => {
  loading.value = true;
  try {
    const result = await window.api.tidal.completeOauth();
    if (!result.ok) {
      // cancelled / 超时 / state 不匹配 等
      toast.error(t("login.tidalOauthFailed", { error: result.error }));
      stage.value = "idle";
      return;
    }
    toast.success(t("login.success"));
    emit("success");
    emit("update:open", false);
  } finally {
    loading.value = false;
  }
};

/** 点击「取消」按钮 */
const handleCancel = (): void => {
  if (stage.value === "waiting") {
    void window.api.tidal.cancelOauth();
  }
  emit("update:open", false);
};

const onOpenUpdate = (value: boolean): void => {
  if (!value) handleCancel();
  else emit("update:open", value);
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('login.oauthTitle')"
    width="min(460px, calc(100vw - 32px))"
    @update:open="onOpenUpdate"
  >
    <div class="flex flex-col gap-3">
      <SAlert>{{ t("login.oauthHint") }}</SAlert>

      <!-- 阶段提示 -->
      <div
        v-if="stage === 'idle'"
        class="rounded-lg bg-surface-panel px-3 py-2 text-xs text-on-surface-variant"
      >
        {{ t("login.oauthStageIdle") }}
      </div>
      <div
        v-else-if="stage === 'waiting'"
        class="rounded-lg bg-info/10 border border-solid border-info/30 px-3 py-2 text-xs text-info"
      >
        {{ t("login.oauthStageWaiting") }}
      </div>

      <!-- 步骤说明 -->
      <ol class="text-xs text-on-surface-variant/80 list-decimal pl-5 space-y-1">
        <li>{{ t("login.oauthStep1") }}</li>
        <li>{{ t("login.oauthStep2") }}</li>
        <li>{{ t("login.oauthStep3") }}</li>
      </ol>
    </div>

    <template #footer>
      <SButton variant="tertiary" :disabled="loading" @click="handleCancel">
        {{ t("common.cancel") }}
      </SButton>
      <SButton
        v-if="stage === 'idle'"
        type="primary"
        :loading="loading"
        @click="startAuth"
      >
        {{ t("login.oauthStart") }}
      </SButton>
      <SButton
        v-else
        type="primary"
        :loading="loading"
        @click="completeAuth"
      >
        {{ t("login.oauthComplete") }}
      </SButton>
    </template>
  </SDialog>
</template>
