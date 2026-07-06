<script setup lang="ts">
import type { MvItem } from "@/apis/mv/netease";
import { fetchMvFirst } from "@/apis/mv/netease";
import { navigateToMv } from "@/utils/navigate";

const { t } = useI18n();

/** 每页数量 */
const PAGE_SIZE = 30;
/** 触底加载阈值（px） */
const SCROLL_THRESHOLD = 200;

/** 地区选项 */
const areaOptions = [
  { value: "", label: t("mv.area.all") },
  { value: "内地", label: t("mv.area.mainland") },
  { value: "港台", label: t("mv.area.hk") },
  { value: "欧美", label: t("mv.area.western") },
  { value: "日本", label: t("mv.area.japan") },
  { value: "韩国", label: t("mv.area.korea") },
];

/** 当前地区 */
const currentArea = ref("");
/** MV 列表 */
const mvs = shallowRef<MvItem[]>([]);
/** 加载中 */
const loading = ref(false);
/** 加载更多中 */
const loadingMore = ref(false);
/** 是否还有更多 */
const hasMore = ref(true);
/** 当前偏移量 */
const offset = ref(0);

/** 加载首页 */
const load = async (): Promise<void> => {
  loading.value = true;
  mvs.value = [];
  offset.value = 0;
  hasMore.value = true;
  try {
    const items = await fetchMvFirst(currentArea.value, PAGE_SIZE, 0);
    mvs.value = items;
    // 不足一页视为无更多
    hasMore.value = items.length >= PAGE_SIZE;
    offset.value = items.length;
  } catch (error) {
    console.warn("[mv] load failed:", error);
  } finally {
    loading.value = false;
  }
};

/** 加载更多 */
const loadMore = async (): Promise<void> => {
  if (loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const items = await fetchMvFirst(currentArea.value, PAGE_SIZE, offset.value);
    if (items.length === 0) {
      hasMore.value = false;
    } else {
      mvs.value = [...mvs.value, ...items];
      offset.value += items.length;
      // 不足一页视为无更多
      if (items.length < PAGE_SIZE) hasMore.value = false;
    }
  } catch (error) {
    console.warn("[mv] load more failed:", error);
  } finally {
    loadingMore.value = false;
  }
};

/** 滚动触底加载 */
const onScroll = (event: Event): void => {
  const el = event.target as HTMLElement;
  if (!el) return;
  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (distanceToBottom < SCROLL_THRESHOLD) void loadMore();
};

/** 切换地区 */
const onAreaChange = (value: string | number | boolean): void => {
  currentArea.value = String(value);
  void load();
};

/** 格式化播放数 */
const formatPlayCount = (count?: number): string => {
  if (!count) return "";
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`;
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)}万`;
  return String(count);
};

onMounted(load);
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pt-2 pb-3">
      <div class="flex items-center gap-5">
        <div
          class="flex size-28 shrink-0 items-center justify-center rounded-2xl border border-solid border-primary/15 bg-primary/8"
        >
          <IconLucideVideo class="size-12 text-primary/60" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ t("mv.title") }}</h1>
          <p class="text-sm text-on-surface-variant/70">{{ t("mv.subtitle") }}</p>
          <div class="flex items-center gap-2">
            <STabs
              :model-value="currentArea"
              :tabs="areaOptions.map((o) => ({ key: o.value, label: o.label }))"
              type="bar"
              size="small"
              @update:model-value="onAreaChange"
            />
          </div>
        </div>
      </div>
    </div>
    <!-- 内容 -->
    <Transition name="fade" mode="out-in" :duration="150">
      <!-- 加载中 -->
      <div
        v-if="loading && mvs.length === 0"
        key="loading"
        class="flex flex-1 items-center justify-center"
      >
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="mx-auto mb-4 block text-4xl text-primary/70" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- MV 网格 -->
      <div
        v-else-if="mvs.length > 0"
        key="list"
        class="min-h-0 flex-1 overflow-y-auto"
        @scroll="onScroll"
      >
        <div class="grid grid-cols-2 gap-4 px-5 pb-6 md:grid-cols-3 lg:grid-cols-4">
          <div
            v-for="mv in mvs"
            :key="mv.id"
            class="group flex cursor-pointer flex-col gap-2"
            @click="navigateToMv(mv.id, { name: mv.name })"
          >
            <div class="relative aspect-video overflow-hidden rounded-lg">
              <SImg
                :src="mv.cover"
                :alt="mv.name"
                class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div
                class="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              >
                <IconLucidePlay class="size-10 text-white" />
              </div>
              <span
                v-if="mv.playCount"
                class="absolute bottom-1 right-1 rounded bg-black/60 px-1.5 py-0.5 text-xs text-white"
              >
                {{ formatPlayCount(mv.playCount) }}
              </span>
            </div>
            <div class="truncate text-sm font-medium text-on-surface">{{ mv.name }}</div>
            <div class="truncate text-xs text-on-surface-variant/50">{{ mv.artistName }}</div>
          </div>
        </div>
        <!-- 加载更多提示 -->
        <div v-if="loadingMore" class="flex justify-center py-4">
          <SLoading class="size-6 text-primary/60" />
        </div>
        <div v-else-if="!hasMore" class="py-4 text-center text-xs text-on-surface-variant/40">
          {{ t("common.noMore") }}
        </div>
      </div>
      <!-- 空状态 -->
      <div v-else key="empty" class="flex flex-1 items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideVideo class="mx-auto mb-3 size-12 opacity-30" />
          <div class="text-sm">{{ t("mv.empty") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
