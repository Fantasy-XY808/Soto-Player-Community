<script setup lang="ts">
import { toast } from "@/composables/useToast";

type Platform = "qobuz" | "prostudiomasters" | "mora";

const props = withDefaults(
  defineProps<{
    open: boolean;
    /**
     * 平台：默认 qobuz（保持向后兼容）。
     * - qobuz: 32 位十六进制 user_auth_token
     * - prostudiomasters: 任意 session token（Bearer JWT / Cookie 串 / 不透明串）
     * - mora: cookie 字符串（如 `session_id=xxx; user_id=yyy`）
     */
    platform?: Platform;
  }>(),
  { platform: "qobuz" },
);
const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 登录成功 */
  success: [];
}>();

const { t } = useI18n();

const raw = ref("");
const loading = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      raw.value = "";
      loading.value = false;
    }
  },
);

/**
 * 平台 → 校验正则
 * - qobuz: 32 位十六进制 user_auth_token
 * - prostudiomasters: 任意非空 session token
 * - mora: cookie 串（必须包含 `=` 字段分隔符）
 */
const tokenRe = computed<RegExp>(() => {
  if (props.platform === "qobuz") return /^[0-9a-f]{32}$/i;
  if (props.platform === "mora") return /=/;
  return /.+/;
});

const isPsm = computed(() => props.platform === "prostudiomasters");
const isMora = computed(() => props.platform === "mora");

/** 平台 → 校验失败时的 i18n key */
const invalidKey = computed<string>(() => {
  if (isPsm.value) return "login.tokenInvalid";
  if (isMora.value) return "login.cookieInvalidMora";
  return "login.tokenInvalid";
});

/** 平台 → 标题 i18n key */
const titleKey = computed<string>(() => {
  if (isPsm.value) return "login.psmTokenTitle";
  if (isMora.value) return "login.moraCookieTitle";
  return "login.tokenTitle";
});

/** 平台 → 提示 i18n key */
const hintKey = computed<string>(() => {
  if (isPsm.value) return "login.psmTokenHint";
  if (isMora.value) return "login.moraCookieHint";
  return "login.tokenHint";
});

/** 平台 → placeholder i18n key */
const placeholderKey = computed<string>(() => {
  if (isPsm.value) return "login.psmTokenPlaceholder";
  if (isMora.value) return "login.moraCookiePlaceholder";
  return "login.tokenPlaceholder";
});

const submit = async (): Promise<void> => {
  const value = raw.value.trim();
  if (!value || !tokenRe.value.test(value)) {
    toast.error(t(invalidKey.value));
    return;
  }
  loading.value = true;
  try {
    if (isMora.value) {
      // mora flow：用户在 mora.jp 登录后从 DevTools 录取 cookie 串
      try {
        await window.api.mora.setToken({
          cookie: value,
          nickname: "mora 用户",
        });
      } catch (err) {
        toast.error(
          t("login.moraLoginFailed", { error: err instanceof Error ? err.message : String(err) }),
        );
        return;
      }
      const statusResult = await window.api.mora.fetchStatus();
      if (!statusResult.ok) {
        toast.error(
          t("login.moraLoginFailed", { error: statusResult.error ?? "unknown" }),
        );
        return;
      }
    } else if (isPsm.value) {
      // PSM flow：用户在 prostudiomasters.com 登录后从 DevTools 录取 session token
      try {
        await window.api.prostudiomasters.setToken({
          sessionToken: value,
          nickname: "prostudiomasters 用户",
        });
      } catch (err) {
        toast.error(
          t("login.psmLoginFailed", { error: err instanceof Error ? err.message : String(err) }),
        );
        return;
      }
      const statusResult = await window.api.prostudiomasters.fetchStatus();
      if (!statusResult.ok) {
        toast.error(
          t("login.psmLoginFailed", { error: statusResult.error ?? "unknown" }),
        );
        return;
      }
    } else {
      // Qobuz flow：保持原行为
      // 1. 先落盘 token，订阅等级与昵称待 fetchStatus 拉取真实 profile 后回写
      const setResult = await window.api.qobuz.setToken({
        userAuthToken: value,
        subscription: "unknown",
        nickname: "",
      });
      if (!setResult.ok) {
        toast.error(t("login.qobuzLoginFailed", { error: setResult.error }));
        return;
      }
      // 2. 拉取真实 profile + subscription，校验 token 是否有效
      const statusResult = await window.api.qobuz.fetchStatus();
      if (!statusResult.ok) {
        toast.error(t("login.qobuzLoginFailed", { error: statusResult.error }));
        return;
      }
    }
    toast.success(t("login.success"));
    emit("success");
    emit("update:open", false);
  } finally {
    loading.value = false;
  }
};

const onOpenUpdate = (value: boolean): void => emit("update:open", value);
</script>

<template>
  <SDialog
    :open="open"
    :title="t(titleKey)"
    width="min(420px, calc(100vw - 32px))"
    @update:open="onOpenUpdate"
  >
    <div class="flex flex-col gap-3">
      <SAlert>{{ t(hintKey) }}</SAlert>
      <SInput
        v-model="raw"
        :type="isMora ? 'textarea' : 'text'"
        :rows="isMora ? 4 : undefined"
        clearable
        :placeholder="t(placeholderKey)"
        :disabled="loading"
      />
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" :disabled="loading" @click="close">
        {{ t("common.cancel") }}
      </SButton>
      <SButton type="primary" :loading="loading" @click="submit">
        {{ t("login.tokenConfirm") }}
      </SButton>
    </template>
  </SDialog>
</template>
