<script setup lang="ts">
import type { CoverItem } from "@/types/artist";
import { fetchDjRadioHot, fetchDjRecommendType } from "@/apis/dj/netease";
import { navigateToRadio } from "@/utils/navigate";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

/** 当前分类 ID（来自 query） */
const categoryId = computed(() => String(route.query.id ?? ""));
/** 当前分类名称 */
const categoryName = computed(() => {
  const n = route.query.name;
  return typeof n === "string" ? n : "";
});

/** 当前激活 Tab：hot / recommend */
const activeTab = ref<"hot" | "recommend">("hot");
/** 热门电台 */
const hotRadios = shallowRef<CoverItem[]>([]);
/** 推荐电台 */
const recRadios = shallowRef<CoverItem[]>([]);
/** 加载中 */
const loading = ref(false);

/** Tabs 配置 */
const tabs = computed(() => [
  { key: "hot", label: t("radio.type.tabs.hot") },
  { key: "recommend", label: t("radio.type.tabs.recommend") },
]);

/** 拉取分类下热门 + 推荐 */
const load = async (): Promise<void> => {
  if (!categoryId.value) return;
  loading.value = true;
  try {
    const [hot, rec] = await Promise.all([
      fetchDjRadioHot(categoryId.value, 30),
      fetchDjRecommendType(categoryId.value),
    ]);
    hotRadios.value = hot;
    recRadios.value = rec;
  } catch (error) {
    console.warn("[radio-type] load failed:", error);
  } finally {
    loading.value = false;
  }
};

/** 当前 Tab 对应的数据 */
const currentList = computed(() =>
  activeTab.value === "hot" ? hotRadios.value : recRadios.value,
);

/** 返回播客主页 */
const goBack = (): void => {
  router.push({ name: "radio-hot" });
};

/** 点击电台卡片跳转详情 */
const onClickRadio = (item: CoverItem): void => {
  navigateToRadio(item.id, { name: item.title });
};

/** 监听 query 变化重新加载（同路由切换分类时） */
watch(
  () => [categoryId.value, categoryName.value],
  () => {
    if (categoryId.value) void load();
  },
);

onMounted(() => {
  if (categoryId.value) void load();
});
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pt-3 pb-2">
      <div class="flex items-center gap-3">
        <SButton type="primary" variant="ghost" circle @click="goBack">
          <template #icon><IconLucideArrowLeft /></template>
        </SButton>
        <h1 class="min-w-0 flex-1 truncate text-2xl font-bold text-on-surface">
          {{ categoryName || t("radio.title") }}
        </h1>
      </div>
    </div>

    <!-- 内容 -->
    <div class="min-h-0 flex-1 overflow-hidden px-5 pb-6">
      <!-- 加载中：骨架 -->
      <div v-if="loading" class="flex flex-col gap-3">
        <div class="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
          <SSkeleton v-for="i in 12" :key="i" class="aspect-square rounded-xl" />
        </div>
      </div>
      <!-- 错误/空 -->
      <div
        v-else-if="currentList.length === 0"
        class="flex h-full items-center justify-center text-on-surface-variant/50"
      >
        <div class="text-center">
          <IconLucideRadio class="mx-auto mb-3 size-12 opacity-30" />
          <div class="text-sm">{{ t("radio.type.empty") }}</div>
        </div>
      </div>
      <!-- 列表 -->
      <div v-else class="flex h-full flex-col gap-3">
        <!-- Tabs -->
        <STabs
          v-model="activeTab"
          :tabs="tabs"
          type="segment"
          animated
          class="self-start"
        />
        <!-- 当前 Tab 内容 -->
        <Transition name="fade" mode="out-in" :duration="150">
          <CoverList
            :key="activeTab"
            :items="currentList"
            :virtual="false"
            :min-size="140"
            :gap="16"
            @click="onClickRadio"
          />
        </Transition>
      </div>
    </div>
  </div>
</template>
