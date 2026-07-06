<script setup lang="ts">
import { computed } from "vue";
import { useUserStore } from "@/stores/user";
import { useQqUserStore } from "@/stores/qqUser";
import { useKugouUserStore } from "@/stores/kugouUser";
import IconLucideCloud from "~icons/lucide/cloud";
import IconLucideMusic2 from "~icons/lucide/music-2";
import IconLucideDog from "~icons/lucide/dog";
import IconLucideCheckCircle2 from "~icons/lucide/check-circle-2";
import IconLucideRefresh from "~icons/lucide/refresh";
import IconLucideSettings from "~icons/lucide/settings";

defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const neteaseUser = useUserStore();
const qqUser = useQqUserStore();
const kugouUser = useKugouUserStore();

interface AccountCardInfo {
  platform: "netease" | "qqmusic" | "kugou";
  icon: unknown;
  titleKey: string;
  nickname: string | null;
  isVip: boolean;
  isLoggedIn: boolean;
  likedCount: number;
  playlistCount: number;
  refresh: () => Promise<void>;
}

const accounts = computed<AccountCardInfo[]>(() => [
  {
    platform: "netease",
    icon: IconLucideCloud,
    titleKey: "login.platformNetease",
    nickname: neteaseUser.profile?.nickname ?? null,
    isVip: !!neteaseUser.profile?.vipType && neteaseUser.profile.vipType !== 0,
    isLoggedIn: neteaseUser.isLoggedIn,
    likedCount: neteaseUser.likedSongIds.size,
    playlistCount: neteaseUser.playlists.length,
    refresh: async () => {
      await neteaseUser.fetchStatus();
    },
  },
  {
    platform: "qqmusic",
    icon: IconLucideMusic2,
    titleKey: "login.platformQQMusic",
    nickname: qqUser.profile?.nickname ?? null,
    isVip: qqUser.isVip,
    isLoggedIn: qqUser.isLoggedIn,
    likedCount: qqUser.likedSongIds.length,
    playlistCount: qqUser.playlists.length,
    refresh: async () => {
      await qqUser.fetchStatus();
      await qqUser.fetchPlaylists();
      await qqUser.fetchLikedSongIds();
    },
  },
  {
    platform: "kugou",
    icon: IconLucideDog,
    titleKey: "login.platformKugou",
    nickname: kugouUser.profile?.nickname ?? null,
    isVip: kugouUser.isVip,
    isLoggedIn: kugouUser.isLoggedIn,
    likedCount: kugouUser.likedSongIds.length,
    playlistCount: kugouUser.playlists.length,
    refresh: async () => {
      await kugouUser.fetchStatus();
      await kugouUser.fetchPlaylists();
      await kugouUser.fetchLikedSongIds();
    },
  },
]);

const anyLoggedIn = computed(() => accounts.value.some((a) => a.isLoggedIn));

/** 全部刷新一次 */
const refreshAll = async (): Promise<void> => {
  await Promise.allSettled(accounts.value.map((a) => a.refresh()));
};

/** 跳转到设置页对应分类 */
const openSettings = (category: string): void => {
  window.api.system.openSettings(category).catch(() => undefined);
  emit("update:open", false);
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('account.switcher.title')"
    width="520px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between">
        <span class="text-xs text-on-surface-variant/70">
          {{ t("account.switcher.subtitle") }}
        </span>
        <SButton size="small" variant="tertiary" :disabled="!anyLoggedIn" @click="refreshAll">
          <template #icon><IconLucideRefresh class="size-3.5" /></template>
          {{ t("account.switcher.refresh") }}
        </SButton>
      </div>
      <div v-if="!anyLoggedIn" class="text-xs text-on-surface-variant/60 px-1 py-6 text-center">
        {{ t("account.switcher.empty") }}
      </div>
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="account in accounts"
          :key="account.platform"
          class="flex items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-3 py-3"
          :class="{ 'opacity-50': !account.isLoggedIn }"
        >
          <div
            class="size-9 rounded-full bg-on-surface/8 flex items-center justify-center shrink-0"
          >
            <component :is="account.icon" class="size-4.5 text-on-surface-variant" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium text-on-surface truncate">
              {{ t(account.titleKey) }}
            </div>
            <div v-if="account.isLoggedIn" class="text-xs text-on-surface-variant/70 truncate mt-0.5">
              <span>{{ account.nickname ?? t("login.unknownUser") }}</span>
              <span v-if="account.isVip" class="ml-1 text-amber-500">
                {{ t("account.switcher.vip") }}
              </span>
              <span class="mx-1.5 text-on-surface-variant/30">·</span>
              <span>{{ t("account.switcher.likedSongs") }} {{ account.likedCount }}</span>
              <span class="mx-1.5 text-on-surface-variant/30">·</span>
              <span>{{ t("account.switcher.playlists") }} {{ account.playlistCount }}</span>
            </div>
            <div v-else class="text-xs text-on-surface-variant/50 mt-0.5">
              {{ t("account.switcher.noLogin") }}
            </div>
          </div>
          <div class="shrink-0 flex items-center gap-1.5">
            <IconLucideCheckCircle2 v-if="account.isLoggedIn" class="size-4 text-emerald-500" />
            <SButton
              size="small"
              variant="tertiary"
              @click="openSettings(account.platform === 'netease' ? 'account' : 'sources')"
            >
              <template #icon><IconLucideSettings class="size-3.5" /></template>
              {{ t("account.switcher.openSettings") }}
            </SButton>
          </div>
        </div>
      </div>
    </div>
    <template #footer="{ close }">
      <SButton type="primary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
