<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import { fetchDjRecommend } from "@/apis/dj/netease";

const { t } = useI18n();

/** 电台列表 */
const radios = shallowRef<CoverItem[]>([]);
/** 加载中 */
const loading = ref(false);

/** 加载电台推荐 */
const load = async (): Promise<void> => {
  loading.value = true;
  try {
    radios.value = await fetchDjRecommend(30);
  } catch (error) {
    console.warn("[radio] load failed:", error);
  } finally {
    loading.value = false;
  }
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
          <IconLucideRadio class="size-12 text-primary/60" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ t("radio.title") }}</h1>
          <p class="text-sm text-on-surface-variant/70">{{ t("radio.subtitle") }}</p>
        </div>
      </div>
    </div>
    <!-- 内容 -->
    <Transition name="fade" mode="out-in" :duration="150">
      <!-- 加载中 -->
      <div
        v-if="loading && radios.length === 0"
        key="loading"
        class="flex flex-1 items-center justify-center"
      >
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="mx-auto mb-4 block text-4xl text-primary/70" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- 电台列表 -->
      <div v-else-if="radios.length > 0" key="list" class="min-h-0 flex-1">
        <CoverList :items="radios" :virtual="false" :padding-x="20" :padding-bottom="24" />
      </div>
      <!-- 空状态 -->
      <div v-else key="empty" class="flex flex-1 items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideRadio class="mx-auto mb-3 size-12 opacity-30" />
          <div class="text-sm">{{ t("radio.empty") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
