<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import type { DjCategory, DjCategoryWithRadios } from "@/apis/dj/netease";
import {
  fetchDjCatelist,
  fetchDjToplist,
  fetchDjCategoryRecommendList,
} from "@/apis/dj/netease";
import { navigateToRadio } from "@/utils/navigate";
import { toast } from "@/composables/useToast";

const { t } = useI18n();
const router = useRouter();

/** 分类网格默认折叠，仅展示前若干项；点击"查看全部"展开 */
const categoriesCollapsed = ref(true);
/** 折叠时可见分类数 */
const COLLAPSED_COUNT = 12;

/** 全部分类 */
const categories = shallowRef<DjCategory[]>([]);
/** 热门推荐 */
const hotRadios = shallowRef<CoverItem[]>([]);
/** 各分类推荐（每个分类含若干电台） */
const categoryGroups = shallowRef<DjCategoryWithRadios[]>([]);
/** 首屏加载中 */
const loading = ref(false);

/** sessionStorage 缓存键 */
const RADIO_CACHE_KEY = "radio:cache";

/** 实际展示的分类：折叠时截断，展开时全部 */
const visibleCategories = computed(() =>
  categoriesCollapsed.value
    ? categories.value.slice(0, COLLAPSED_COUNT)
    : categories.value,
);

/** 是否还有未展示的分类（用于切换按钮文案） */
const hasMoreCategories = computed(() => categories.value.length > COLLAPSED_COUNT);

/** 把首屏数据写入 sessionStorage 缓存（仅成功项才写） */
const saveCache = (
  cat: DjCategory[] | null,
  hot: CoverItem[] | null,
  groups: DjCategoryWithRadios[] | null,
): void => {
  try {
    sessionStorage.setItem(
      RADIO_CACHE_KEY,
      JSON.stringify({
        categories: cat,
        hotRadios: hot,
        categoryGroups: groups,
        ts: Date.now(),
      }),
    );
  } catch {
    // sessionStorage 满或被禁用：忽略
  }
};

/** 从 sessionStorage 读缓存，命中则填充到响应式状态 */
const restoreCache = (): boolean => {
  try {
    const raw = sessionStorage.getItem(RADIO_CACHE_KEY);
    if (!raw) return false;
    const cache = JSON.parse(raw) as {
      categories?: DjCategory[] | null;
      hotRadios?: CoverItem[] | null;
      categoryGroups?: DjCategoryWithRadios[] | null;
    };
    if (cache.categories) categories.value = cache.categories;
    if (cache.hotRadios) hotRadios.value = cache.hotRadios;
    if (cache.categoryGroups) categoryGroups.value = cache.categoryGroups;
    return true;
  } catch {
    return false;
  }
};

/** 拉取首屏数据：分类 + 热门榜 + 分类推荐
 *
 * 使用 Promise.allSettled：任一接口失败不影响其他接口的数据展示，
 * 避免 dj_catelist 等 weapi 接口在匿名注册冷却期内 301 时整体显示空状态。
 * 全部失败时弹 toast 提示并尝试回退到 sessionStorage 缓存。
 */
const load = async (): Promise<void> => {
  loading.value = true;
  try {
    const results = await Promise.allSettled([
      fetchDjCatelist(),
      fetchDjToplist("hot", 18),
      fetchDjCategoryRecommendList(),
    ]);

    const catList = results[0].status === "fulfilled" ? results[0].value : null;
    const hot = results[1].status === "fulfilled" ? results[1].value : null;
    const groups = results[2].status === "fulfilled" ? results[2].value : null;

    if (catList) categories.value = catList;
    if (hot) hotRadios.value = hot;
    if (groups) {
      categoryGroups.value = groups.filter((g) => g.radios.length > 0).slice(0, 6);
    }

    const allFailed = results.every((r) => r.status === "rejected");
    if (allFailed) {
      // 全部失败：尝试缓存兜底
      const hasCache = restoreCache();
      if (hasCache) {
        toast.warning(t("radio.hot.loadFailedButCache"));
      } else {
        toast.error(t("radio.hot.loadFailed"));
      }
    } else {
      // 部分或全部成功：写入缓存
      saveCache(
        catList ?? categories.value,
        hot ?? hotRadios.value,
        groups ?? categoryGroups.value,
      );
      // 部分失败时给用户一个温和提示
      const someFailed = results.some((r) => r.status === "rejected");
      if (someFailed) {
        toast.warning(t("radio.hot.partialFailed"));
      }
    }
  } catch (error) {
    // allSettled 不会 reject，这里防御性兜底
    console.warn("[radio-hot] load failed:", error);
    toast.error(t("radio.hot.loadFailed"));
  } finally {
    loading.value = false;
  }
};

/** 用户主动刷新：重置 netease 匿名注册冷却后再加载
 *
 * 匿名注册失败冷却期内，dj_catelist 等 weapi 接口会持续 301，
 * 直接刷新无意义。先通过 IPC 重置冷却，下一次请求会立即重试 register_anonimous。
 */
const refresh = async (): Promise<void> => {
  try {
    await window.api.apis.resetNeteaseAnonymousCooldown();
  } catch {
    // IPC 失败不阻塞刷新
  }
  await load();
};

/** 点击分类卡片：跳转分类详情页（query 传 id+name，避免再发一次请求） */
const onClickCategory = (cat: DjCategory): void => {
  router.push({
    name: "radio-type",
    query: { id: cat.id, name: cat.name },
  });
};

/** 切换折叠状态 */
const toggleCollapse = (): void => {
  categoriesCollapsed.value = !categoriesCollapsed.value;
};

/** 点击电台卡片跳转详情 */
const onClickRadio = (item: CoverItem): void => {
  navigateToRadio(item.id, { name: item.title });
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
        <SButton
          variant="tertiary"
          size="small"
          round
          :loading="loading"
          :disabled="loading"
          class="shrink-0"
          @click="refresh"
        >
          <template #icon><IconLucideRefreshCw /></template>
          {{ t("common.refresh") }}
        </SButton>
      </div>
    </div>

    <!-- 滚动区 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <!-- 分类网格 -->
      <section class="mb-6">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-on-surface">
            {{ t("radio.hot.categoriesTitle") }}
          </h2>
          <SButton
            v-if="hasMoreCategories"
            variant="tertiary"
            size="small"
            round
            @click="toggleCollapse"
          >
            {{ categoriesCollapsed ? t("radio.hot.categoriesMore") : t("radio.hot.categoriesCollapse") }}
          </SButton>
        </div>
        <!-- 加载骨架 -->
        <div
          v-if="loading && categories.length === 0"
          class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6"
        >
          <SSkeleton v-for="i in 12" :key="i" class="h-12" />
        </div>
        <!-- 分类卡片 -->
        <div
          v-else-if="categories.length > 0"
          class="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6"
        >
          <SCard
            v-for="cat in visibleCategories"
            :key="cat.id"
            radius="lg"
            size="small"
            hoverable
            class="flex cursor-pointer items-center justify-center gap-2 px-3"
            @click="onClickCategory(cat)"
          >
            <SImg
              v-if="cat.pic"
              :src="cat.pic"
              :alt="cat.name"
              class="size-5 shrink-0 rounded object-cover"
            />
            <IconLucideTag v-else class="size-4 shrink-0 text-primary/60" />
            <span class="truncate text-sm text-on-surface">{{ cat.name }}</span>
          </SCard>
        </div>
        <div
          v-else
          class="flex items-center justify-center py-8 text-sm text-on-surface-variant/50"
        >
          {{ t("radio.hot.emptyCategories") }}
        </div>
      </section>

      <!-- 热门推荐 -->
      <section v-if="hotRadios.length > 0" class="mb-6">
        <h2 class="mb-3 text-lg font-semibold text-on-surface">
          {{ t("radio.hot.hotRecommend") }}
        </h2>
        <CoverList :items="hotRadios" :virtual="false" :min-size="140" :gap="16" @click="onClickRadio" />
      </section>

      <!-- 分类推荐 -->
      <section
        v-for="group in categoryGroups"
        :key="group.id"
        class="mb-6"
      >
        <div class="mb-3 flex items-center justify-between">
          <h2 class="text-lg font-semibold text-on-surface">{{ group.name }}</h2>
          <SButton
            variant="tertiary"
            size="small"
            round
            @click="onClickCategory(group)"
          >
            <template #icon><IconLucideChevronRight /></template>
            {{ t("common.more") }}
          </SButton>
        </div>
        <CoverList :items="group.radios" :virtual="false" :min-size="140" :gap="16" @click="onClickRadio" />
      </section>

      <!-- 空状态（仅当所有区块都为空时） -->
      <div
        v-if="!loading && categories.length === 0 && hotRadios.length === 0 && categoryGroups.length === 0"
        class="flex flex-1 items-center justify-center py-16"
      >
        <div class="flex flex-col items-center gap-4 text-center text-on-surface-variant/50">
          <IconLucideRadio class="size-12 opacity-30" />
          <div class="text-sm">{{ t("radio.empty") }}</div>
          <SButton variant="tertiary" size="small" round @click="refresh">
            <template #icon><IconLucideRefreshCw /></template>
            {{ t("common.retry") }}
          </SButton>
        </div>
      </div>
    </div>
  </div>
</template>
