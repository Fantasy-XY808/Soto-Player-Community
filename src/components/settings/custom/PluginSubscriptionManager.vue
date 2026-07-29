<script setup lang="ts">
import type { MfSubscription } from "@shared/types/plugin";
import { usePluginsStore } from "@/stores/plugins";
import { toast } from "@/composables/useToast";
import { isExternalUrl } from "@/utils/url";

/**
 * MusicFree 插件订阅管理
 * - 列出 plugins.subscriptions 中的订阅项（title + srcUrl）
 * - 添加 / 删除单条订阅
 * - 一键更新全部订阅（逐条拉取最新脚本并安装）
 *
 * 订阅本身只是一组脚本 URL 书签；MusicFree 协议下每个 srcUrl 直接指向一个插件脚本。
 */
const { t } = useI18n();
const pluginsStore = usePluginsStore();
const { subscriptions, subscriptionsLoaded } = storeToRefs(pluginsStore);

const adding = ref(false);
const newTitle = ref("");
const newUrl = ref("");
const refreshing = ref(false);
/** 最近一次"更新全部"的逐条结果，按 srcUrl 索引 */
const refreshResults = ref<Array<{ srcUrl: string; ok: boolean; error?: string }>>([]);

onMounted(async () => {
  if (!subscriptionsLoaded.value) await pluginsStore.loadSubscriptions();
});

const handleAdd = async (): Promise<void> => {
  const url = newUrl.value.trim();
  const title = newTitle.value.trim();
  if (!isExternalUrl(url)) {
    toast.error(t("settings.plugins.subscription.urlInvalid"));
    return;
  }
  if (subscriptions.value.some((item) => item.srcUrl === url)) {
    toast.error(t("settings.plugins.subscription.duplicate"));
    return;
  }
  const next: MfSubscription[] = [
    ...subscriptions.value,
    { title: title || url, srcUrl: url },
  ];
  await pluginsStore.saveSubscriptions(next);
  newTitle.value = "";
  newUrl.value = "";
  adding.value = false;
  toast.success(t("settings.plugins.subscription.addSuccess"));
};

const handleRemove = async (srcUrl: string): Promise<void> => {
  const next = subscriptions.value.filter((item) => item.srcUrl !== srcUrl);
  await pluginsStore.saveSubscriptions(next);
  toast.success(t("settings.plugins.subscription.removeSuccess"));
};

const handleRefreshAll = async (): Promise<void> => {
  if (subscriptions.value.length === 0) {
    toast.warning(t("settings.plugins.subscription.empty"));
    return;
  }
  refreshing.value = true;
  try {
    refreshResults.value = await pluginsStore.refreshAllSubscriptions();
    const okCount = refreshResults.value.filter((r) => r.ok).length;
    const total = refreshResults.value.length;
    if (okCount === total) {
      toast.success(t("settings.plugins.subscription.refreshAllSuccess", { count: okCount }));
    } else {
      toast.warning(
        t("settings.plugins.subscription.refreshPartial", { ok: okCount, total }),
      );
    }
  } finally {
    refreshing.value = false;
  }
};

const handleRefreshOne = async (srcUrl: string): Promise<void> => {
  const res = await pluginsStore.installFromSubscription(srcUrl);
  if (res.ok) toast.success(t("settings.plugins.subscription.refreshOneSuccess"));
  else toast.error(res.error ?? t("settings.plugins.subscription.refreshOneFailed"));
};
</script>

<template>
  <div
    class="flex flex-col gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3"
  >
    <!-- 标题行 -->
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <IconLucideRss class="size-4 text-primary shrink-0" />
          <span class="text-sm font-medium text-on-surface">
            {{ t("settings.plugins.subscription.title") }}
          </span>
        </div>
        <div class="text-xs text-on-surface-variant/60 mt-0.5">
          {{ t("settings.plugins.subscription.hint") }}
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <SButton
          v-if="!adding"
          variant="secondary"
          size="small"
          :loading="refreshing"
          @click="handleRefreshAll"
        >
          <template #icon>
            <IconLucideRefreshCw class="size-4" />
          </template>
          {{ t("settings.plugins.subscription.refreshAll") }}
        </SButton>
        <SButton
          v-if="!adding"
          variant="secondary"
          size="small"
          @click="adding = true"
        >
          <template #icon>
            <IconLucidePlus class="size-4" />
          </template>
          {{ t("settings.plugins.subscription.add") }}
        </SButton>
      </div>
    </div>

    <!-- 添加表单 -->
    <div v-if="adding" class="flex flex-col gap-2 border-t border-outline-variant/15 pt-3">
      <SInput
        v-model="newTitle"
        :placeholder="t('settings.plugins.subscription.titlePlaceholder')"
      />
      <SInput
        v-model="newUrl"
        :placeholder="t('settings.plugins.subscription.urlPlaceholder')"
        clearable
      />
      <div class="flex justify-end gap-2">
        <SButton variant="secondary" size="small" @click="adding = false">
          {{ t("common.cancel") }}
        </SButton>
        <SButton variant="secondary" type="primary" size="small" @click="handleAdd">
          {{ t("common.confirm") }}
        </SButton>
      </div>
    </div>

    <!-- 订阅列表 -->
    <div v-if="subscriptions.length > 0" class="flex flex-col gap-2 border-t border-outline-variant/15 pt-3">
      <div
        v-for="item in subscriptions"
        :key="item.srcUrl"
        class="flex items-center gap-3 rounded-lg bg-on-surface/4 px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="text-sm text-on-surface truncate">{{ item.title || item.srcUrl }}</div>
          <div class="text-xs text-on-surface-variant/60 truncate">{{ item.srcUrl }}</div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button
            type="button"
            class="p-1.5 border-none bg-transparent text-on-surface-variant/60 hover:text-primary cursor-pointer transition-colors"
            :title="t('settings.plugins.subscription.refreshOne')"
            :disabled="refreshing"
            @click="handleRefreshOne(item.srcUrl)"
          >
            <IconLucideRefreshCw class="size-4" />
          </button>
          <button
            type="button"
            class="p-1.5 border-none bg-transparent text-on-surface-variant/60 hover:text-error cursor-pointer transition-colors"
            :title="t('common.delete')"
            @click="handleRemove(item.srcUrl)"
          >
            <IconLucideTrash2 class="size-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- 空态 -->
    <div
      v-else
      class="text-xs text-on-surface-variant/50 text-center py-2 border-t border-outline-variant/15"
    >
      {{ t("settings.plugins.subscription.empty") }}
    </div>

    <!-- 上次更新结果 -->
    <div
      v-if="refreshResults.length > 0"
      class="flex flex-col gap-1 border-t border-outline-variant/15 pt-2"
    >
      <div class="text-xs text-on-surface-variant/60">
        {{ t("settings.plugins.subscription.lastResult") }}
      </div>
      <div
        v-for="r in refreshResults"
        :key="r.srcUrl"
        class="flex items-center gap-2 text-xs"
      >
        <IconLucideCheckCircle2 v-if="r.ok" class="size-3.5 text-success shrink-0" />
        <IconLucideXCircle v-else class="size-3.5 text-error shrink-0" />
        <span class="text-on-surface-variant truncate flex-1">{{ r.srcUrl }}</span>
        <span v-if="!r.ok" class="text-error/80 truncate max-w-[40%]">{{ r.error }}</span>
      </div>
    </div>
  </div>
</template>