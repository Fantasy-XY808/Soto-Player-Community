<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import { useTidalUserStore } from "@/stores/tidalUser";
import LoginOauthDialog from "@/components/modals/LoginOauthDialog.vue";
import IconLucideUserRound from "~icons/lucide/user-round";
import IconLucideLogOut from "~icons/lucide/log-out";
import IconLucideKeyRound from "~icons/lucide/key-round";
import IconLucideAlertTriangle from "~icons/lucide/alert-triangle";

const { t } = useI18n();
const tidalUser = useTidalUserStore();

const dialogOpen = ref(false);

/** 订阅等级对应的 i18n key 与配色 */
const subscriptionMeta = computed<{ labelKey: string; classes: string }>(() => {
  const tier = tidalUser.profile?.subscription ?? "unknown";
  switch (tier) {
    case "free":
      return {
        labelKey: "login.tidalSubscriptionFree",
        classes: "text-amber-600 dark:text-amber-400",
      };
    case "hifi":
      return {
        labelKey: "login.tidalSubscriptionHifi",
        classes: "text-emerald-600 dark:text-emerald-400",
      };
    case "hifi_plus":
      return {
        labelKey: "login.tidalSubscriptionHifiPlus",
        classes: "text-emerald-600 dark:text-emerald-400",
      };
    default:
      return {
        labelKey: "login.tidalSubscriptionUnknown",
        classes: "text-on-surface-variant/70",
      };
  }
});

/** Free 账号仅可播放 AAC 96kbps，需订阅才能播放 FLAC / MQA */
const showFreeWarning = computed(
  () => tidalUser.isLoggedIn && tidalUser.profile?.subscription === "free",
);

const handleLogin = (): void => {
  dialogOpen.value = true;
};

const handleLogout = async (): Promise<void> => {
  const ok = await dialog.confirm({
    title: t("login.logoutConfirmTitle"),
    content: t("login.logoutConfirmDesc"),
    type: "warning",
  });
  if (!ok) return;
  await tidalUser.logout();
  toast.success(t("login.logoutDone"));
};

const onSuccess = (): void => {
  tidalUser.fetchStatus().catch(() => undefined);
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
    >
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div
          class="size-10 rounded-full overflow-hidden bg-on-surface/10 flex items-center justify-center shrink-0"
        >
          <IconLucideUserRound class="size-5 text-on-surface-variant" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium text-on-surface truncate">
            {{ t("account.tidal.title") }}
          </div>
          <div class="text-xs text-on-surface-variant/70 mt-0.5 truncate">
            <template v-if="tidalUser.isLoggedIn">
              {{ tidalUser.profile?.nickname || t("login.unknownUser") }}
              <span :class="['ml-1', subscriptionMeta.classes]">
                {{ t(subscriptionMeta.labelKey) }}
              </span>
            </template>
            <template v-else>{{ t("account.tidal.description") }}</template>
          </div>
        </div>
      </div>
      <div class="shrink-0 flex items-center gap-2">
        <SButton
          v-if="tidalUser.isLoggedIn"
          variant="secondary"
          size="small"
          type="error"
          @click="handleLogout"
        >
          <template #icon><IconLucideLogOut class="size-4" /></template>
          {{ t("login.logout") }}
        </SButton>
        <SButton v-else variant="secondary" size="small" type="primary" @click="handleLogin">
          <template #icon><IconLucideKeyRound class="size-4" /></template>
          {{ t("login.oauthLogin") }}
        </SButton>
      </div>
    </div>

    <!-- Free 账号提示：仅可播放 AAC 96kbps -->
    <div
      v-if="showFreeWarning"
      class="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-solid border-amber-500/30 px-3 py-2"
    >
      <IconLucideAlertTriangle class="size-4 text-amber-500 shrink-0" />
      <span class="text-xs text-amber-600 dark:text-amber-400 flex-1">
        {{ t("login.tidalFreeWarning") }}
      </span>
    </div>

    <!-- fetchStatus 失败时提示 token 可能已失效 -->
    <div
      v-if="tidalUser.isLoggedIn && tidalUser.statusError"
      class="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-solid border-amber-500/30 px-3 py-2"
    >
      <IconLucideAlertTriangle class="size-4 text-amber-500 shrink-0" />
      <span class="text-xs text-amber-600 dark:text-amber-400 flex-1">
        {{ t("login.cookieExpiredHint") }}
      </span>
      <SButton size="small" variant="tertiary" @click="handleLogin">
        {{ t("login.oauthLogin") }}
      </SButton>
    </div>

    <LoginOauthDialog v-model:open="dialogOpen" @success="onSuccess" />
  </div>
</template>
