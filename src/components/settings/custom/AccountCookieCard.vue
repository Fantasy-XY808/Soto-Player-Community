<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { dialog } from "@/composables/useDialog";
import { useQqUserStore } from "@/stores/qqUser";
import { useKugouUserStore } from "@/stores/kugouUser";
import IconLucideUserRound from "~icons/lucide/user-round";
import IconLucideLogOut from "~icons/lucide/log-out";
import IconLucideKeyRound from "~icons/lucide/key-round";
import IconLucideAlertTriangle from "~icons/lucide/alert-triangle";

type Platform = "qqmusic" | "kugou";

const props = defineProps<{ platform: Platform }>();

const { t } = useI18n();
const qqUser = useQqUserStore();
const kugouUser = useKugouUserStore();

const store = computed(() => (props.platform === "qqmusic" ? qqUser : kugouUser));

/** 平台 → 标题 i18n key */
const titleKey = computed(() =>
  props.platform === "qqmusic" ? "account.qq.title" : "account.kugou.title",
);
/** 平台 → 描述 i18n key */
const descKey = computed(() =>
  props.platform === "qqmusic" ? "account.qq.description" : "account.kugou.description",
);

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
  await store.value.logout();
  toast.success(t("login.logoutDone"));
};

const onSuccess = (): void => {
  store.value.fetchStatus().catch(() => undefined);
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
            {{ t(titleKey) }}
          </div>
          <div class="text-xs text-on-surface-variant/70 mt-0.5 truncate">
            <template v-if="store.isLoggedIn">
              {{ store.profile?.nickname }}
              <span v-if="store.isVip" class="ml-1 text-amber-500">VIP</span>
            </template>
            <template v-else>{{ t(descKey) }}</template>
          </div>
        </div>
      </div>
      <div class="shrink-0 flex items-center gap-2">
        <SButton
          v-if="store.isLoggedIn"
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
          {{ t("login.manualCookie") }}
        </SButton>
      </div>
    </div>
    <!-- fetchStatus 失败时提示 cookie 可能已失效 -->
    <div
      v-if="store.isLoggedIn && store.statusError"
      class="flex items-center gap-2 rounded-lg bg-amber-500/10 border border-solid border-amber-500/30 px-3 py-2"
    >
      <IconLucideAlertTriangle class="size-4 text-amber-500 shrink-0" />
      <span class="text-xs text-amber-600 dark:text-amber-400 flex-1">
        {{ t("login.cookieExpiredHint") }}
      </span>
      <SButton size="small" variant="tertiary" @click="handleLogin">
        {{ t("login.manualCookie") }}
      </SButton>
    </div>

    <LoginCookieDialog v-model:open="dialogOpen" :platform="platform" @success="onSuccess" />
  </div>
</template>
