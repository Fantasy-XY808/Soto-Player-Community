<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import { useUserStore } from "@/stores/user";
import CoverList from "@/components/list/CoverList.vue";
import { navigateToRadio } from "@/utils/navigate";

const { t } = useI18n();
const user = useUserStore();

/** 我订阅的电台 */
const radios = computed(() => user.radios);

/** 点击电台卡片跳转详情 */
const onClick = (item: CoverItem): void => {
  navigateToRadio(item.id, { name: item.title });
};

/** 刷新订阅列表 */
const onRefresh = (): void => {
  void user.refreshRadios();
};

onMounted(() => {
  if (user.isLoggedIn) void user.ensureRadios();
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="flex items-baseline justify-between gap-4 mt-2 mb-4">
        <div class="flex items-baseline gap-3 min-w-0">
          <h1 class="text-3xl font-bold text-on-surface shrink-0 text-balance">
            {{ t("radio.subscriptions.title") }}
          </h1>
          <span
            v-if="user.isLoggedIn"
            class="flex items-center gap-1.5 text-sm text-on-surface-variant/50 truncate"
          >
            <IconLucideListMusic class="size-3.5 shrink-0" />
            {{ t("common.totalPlaylists", { count: radios.length }) }}
          </span>
        </div>
        <SButton
          v-if="user.isLoggedIn"
          variant="tertiary"
          round
          size="small"
          :disabled="user.radiosLoading"
          @click="onRefresh"
        >
          <template #icon><IconLucideRefreshCw /></template>
          {{ t("common.refreshCache") }}
        </SButton>
      </div>
    </div>
    <!-- 未登录 -->
    <div v-if="!user.isLoggedIn" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideRadio class="size-12 mx-auto mb-3 opacity-30" />
        <div class="text-sm">{{ t("radio.subscriptions.notLogin") }}</div>
      </div>
    </div>
    <!-- 加载中 -->
    <div
      v-else-if="user.radiosLoading && radios.length === 0"
      class="flex-1 flex items-center justify-center"
    >
      <div class="text-center text-on-surface-variant/60">
        <SLoading class="mx-auto mb-3 block text-3xl text-primary/70" />
        <div class="text-sm">{{ t("common.loading") }}</div>
      </div>
    </div>
    <!-- 内容 -->
    <Transition v-else name="fade" mode="out-in" :duration="150">
      <div v-if="radios.length > 0" key="list" class="flex-1 min-h-0">
        <CoverList
          :items="radios"
          :padding-x="20"
          :padding-top="8"
          :padding-bottom="20"
          @click="onClick"
        />
      </div>
      <div v-else key="empty" class="flex-1 flex items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideRadio class="size-12 mx-auto mb-3 opacity-30" />
          <div class="text-sm">{{ t("radio.subscriptions.empty") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
