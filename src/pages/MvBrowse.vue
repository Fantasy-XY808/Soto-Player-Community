<script setup lang="ts">
import type { MvItem } from "@/apis/mv/netease";
import { fetchMvFirst } from "@/apis/mv/netease";

const { t } = useI18n();

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

/** 加载 MV */
const load = async (): Promise<void> => {
  loading.value = true;
  try {
    mvs.value = await fetchMvFirst(currentArea.value, 30);
  } catch (error) {
    console.warn("[mv] load failed:", error);
  } finally {
    loading.value = false;
  }
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
      <div v-else-if="mvs.length > 0" key="list" class="min-h-0 flex-1 overflow-y-auto">
        <div class="grid grid-cols-2 gap-4 px-5 pb-6 md:grid-cols-3 lg:grid-cols-4">
          <div v-for="mv in mvs" :key="mv.id" class="group flex flex-col gap-2">
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
