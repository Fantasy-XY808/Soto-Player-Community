<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import { useMoraUserStore } from "@/stores/moraUser";
import LoginTokenDialog from "@/components/modals/LoginTokenDialog.vue";
import IconLucideUserRound from "~icons/lucide/user-round";
import IconLucideLogOut from "~icons/lucide/log-out";
import IconLucideKeyRound from "~icons/lucide/key-round";
import IconLucideAlertTriangle from "~icons/lucide/alert-triangle";
import IconLucideInfo from "~icons/lucide/info";

const { t } = useI18n();
const moraUser = useMoraUserStore();

const dialogOpen = ref(false);

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
  await moraUser.logout();
  toast.success(t("login.logoutDone"));
};

const onSuccess = (): void => {
  moraUser.fetchStatus().catch(() => undefined);
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
            {{ t("account.mora.title") }}
          </div>
          <div class="text-xs text-on-surface-variant/70 mt-0.5 truncate">
            <template v-if="moraUser.isLoggedIn">
              {{ moraUser.profile?.nickname || t("login.unknownUser") }}
            </template>
            <template v-else>{{ t("account.mora.description") }}</template>
          </div>
        </div>
      </div>
      <div class="shrink-0 flex items-center gap-2">
        <SButton
          v-if="moraUser.isLoggedIn"
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
          {{ t("login.cookieLogin") }}
        </SButton>
      </div>
    </div>

    <!-- fetchStatus 失败时提示 cookie 可能已失效 -->
    <div
      v-if="moraUser.isLoggedIn && moraUser.statusError"
      class="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-solid border-amber-500/30 px-3 py-2"
    >
      <IconLucideAlertTriangle class="size-4 text-amber-500 shrink-0" />
      <span class="text-xs text-amber-600 dark:text-amber-400 flex-1">
        {{ t("login.cookieExpiredHint") }}
      </span>
      <SButton size="small" variant="tertiary" @click="handleLogin">
        {{ t("login.cookieLogin") }}
      </SButton>
    </div>

    <!-- 合规提示：mora 试听免登录；完整 Hi-Res 母带需在 mora.jp 购买后用 mora Downloader 客户端下载 -->
    <div
      class="flex items-start gap-2 rounded-lg bg-surface-panel border border-solid border-outline-variant/15 px-3 py-2"
    >
      <IconLucideInfo class="size-4 text-on-surface-variant shrink-0 mt-0.5" />
      <span class="text-xs text-on-surface-variant/80 flex-1">
        {{ t("account.mora.hint") }}
      </span>
    </div>

    <LoginTokenDialog v-model:open="dialogOpen" platform="mora" @success="onSuccess" />
  </div>
</template>
