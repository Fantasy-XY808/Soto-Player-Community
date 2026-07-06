<script setup lang="ts">
import type { DjDetail, DjProgram } from "@/apis/dj/netease";
import { fetchDjDetail, fetchDjPrograms } from "@/apis/dj/netease";
import SongList from "@/components/list/SongList.vue";
import * as player from "@/core/player";
import { useImagePreload } from "@/composables/useImagePreload";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

/** 路由参数中的电台 ID */
const rid = computed(() => decodeURIComponent(String(route.params.id ?? "")));

/** URL query 兜底标题（详情未拉到时空标题） */
const fallbackName = computed(() => {
  const n = route.query.name;
  return typeof n === "string" ? n : "";
});

/** 电台详情 */
const detail = shallowRef<DjDetail | null>(null);
/** 节目列表 */
const programs = shallowRef<DjProgram[]>([]);
/** 节目总数（来自接口 count 字段，用于判断是否还能分页） */
const total = ref(0);
/** 加载中（首次） */
const loading = ref(false);
/** 加载更多中 */
const loadingMore = ref(false);
/** 错误信息 */
const error = ref("");

/**
 * 预加载封面：detail 拉到后立即开始解码，SImg 渲染时直接命中浏览器缓存，
 * 避免封面位闪一下占位图。loaded 仅用于淡入时机（这里只取预热副作用）。
 */
const coverUrl = computed(() => detail.value?.cover ?? "");
useImagePreload(coverUrl);

/** 每页数量 */
const PAGE_SIZE = 30;

/** 是否还有更多 */
const hasMore = computed(() => programs.value.length < total.value);

/** 拉取电台详情 + 首屏节目 */
const load = async (): Promise<void> => {
  if (!rid.value) return;
  loading.value = true;
  error.value = "";
  try {
    const [info, programsResult] = await Promise.all([
      fetchDjDetail(rid.value),
      fetchDjPrograms(rid.value, 0, PAGE_SIZE),
    ]);
    if (!info) {
      error.value = t("radio.detail.notFound");
      return;
    }
    detail.value = info;
    programs.value = programsResult.list;
    total.value = programsResult.total;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
};

/** 触底加载更多节目 */
const loadMore = async (): Promise<void> => {
  if (loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const offset = programs.value.length;
    const result = await fetchDjPrograms(rid.value, offset, PAGE_SIZE);
    // 接口可能返回重复节目（节目排序变动），按 id 去重
    const existed = new Set(programs.value.map((p) => p.id));
    const fresh = result.list.filter((p) => !existed.has(p.id));
    if (fresh.length > 0) {
      programs.value = [...programs.value, ...fresh];
    }
    total.value = result.total;
  } catch (err) {
    console.warn("[radio-detail] load more failed:", err);
  } finally {
    loadingMore.value = false;
  }
};

/** 当前可播放的 Track 列表（programs → track） */
const tracks = computed(() => programs.value.map((p) => p.track));

/** 播放全部：把节目作为队列，从第一首开始 */
const handlePlayAll = (): void => {
  if (tracks.value.length === 0) return;
  void player.playFrom(tracks.value, 0);
};

/** 返回上一页 */
const goBack = (): void => {
  if (window.history.length > 1) router.back();
  else router.push({ name: "radio" });
};

/** 格式化播放数 */
const formatListenerCount = (count?: number): string => {
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
    <div class="shrink-0 px-5 pt-3 pb-2">
      <div class="flex items-center gap-3">
        <SButton type="primary" variant="ghost" circle @click="goBack">
          <template #icon><IconLucideArrowLeft /></template>
        </SButton>
        <h1 class="min-w-0 flex-1 truncate text-2xl font-bold text-on-surface">
          {{ detail?.name ?? fallbackName ?? t("radio.detail.loading") }}
        </h1>
      </div>
    </div>
    <!-- 内容 -->
    <div class="min-h-0 flex-1 overflow-hidden px-5 pb-6">
      <!-- 加载中（首屏）：骨架屏占位，模拟头部卡片 + 节目列表布局 -->
      <div v-if="loading" class="flex h-full flex-col gap-4">
        <div class="flex shrink-0 gap-5">
          <SSkeleton class="size-40 shrink-0 rounded-xl" />
          <div class="flex min-w-0 flex-1 flex-col gap-2 py-1">
            <SSkeleton class="h-3 w-12" />
            <SSkeleton class="h-8 w-2/3" />
            <SSkeleton class="h-4 w-1/2" />
            <SSkeleton type="lines" :lines="2" />
          </div>
        </div>
        <div class="min-h-0 flex-1 flex flex-col gap-2">
          <SSkeleton v-for="i in 6" :key="i" class="h-14" />
        </div>
      </div>
      <!-- 错误态 -->
      <div v-else-if="error" class="flex h-full items-center justify-center">
        <div class="text-center text-red-500/85">
          <IconLucideTriangleAlert class="mx-auto mb-4 size-14 opacity-50" />
          <div class="text-sm font-medium mb-1">{{ t("radio.detail.errorTitle") }}</div>
          <div class="text-xs opacity-80 break-all max-w-sm">{{ error }}</div>
        </div>
      </div>
      <!-- 详情 + 节目列表 -->
      <div v-else-if="detail" class="flex h-full flex-col gap-4">
        <!-- 电台信息卡片 -->
        <div class="flex shrink-0 gap-5">
          <SImg
            :src="detail.cover"
            :alt="detail.name"
            class="size-40 shrink-0 rounded-xl object-cover"
          />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <div class="text-xs text-on-surface-variant/60">{{ t("radio.detail.badge") }}</div>
            <h2 class="text-3xl font-bold text-on-surface text-balance truncate">
              {{ detail.name }}
            </h2>
            <div
              class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-on-surface-variant/70"
            >
              <span v-if="detail.dj" class="flex items-center gap-1">
                <IconLucideUser class="size-3.5" />
                {{ detail.dj }}
              </span>
              <span v-if="detail.category" class="flex items-center gap-1">
                <IconLucideTag class="size-3.5" />
                {{ detail.category }}
              </span>
              <span class="flex items-center gap-1">
                <IconLucideListMusic class="size-3.5" />
                {{ t("radio.detail.programCount", { count: detail.programCount }) }}
              </span>
              <span v-if="detail.subCount" class="flex items-center gap-1">
                <IconLucideUsers class="size-3.5" />
                {{ t("radio.detail.subCount", { count: formatListenerCount(detail.subCount) }) }}
              </span>
            </div>
            <p
              v-if="detail.desc"
              class="line-clamp-2 text-sm text-on-surface-variant/60 whitespace-pre-wrap"
            >
              {{ detail.desc }}
            </p>
            <div class="mt-auto">
              <SButton
                type="primary"
                variant="secondary"
                round
                :disabled="tracks.length === 0"
                @click="handlePlayAll"
              >
                <template #icon><IconLucidePlay /></template>
                {{ t("common.playAll") }}
              </SButton>
            </div>
          </div>
        </div>
        <!-- 节目列表 -->
        <div class="min-h-0 flex-1">
          <SongList
            v-if="tracks.length > 0"
            :items="tracks"
            :show-album="false"
            :show-size="false"
            :source="'netease'"
            :has-more="hasMore"
            :loading-more="loadingMore"
            @reach-bottom="loadMore"
          />
          <div
            v-else
            class="flex h-full items-center justify-center text-sm text-on-surface-variant/50"
          >
            {{ t("radio.detail.emptyPrograms") }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
