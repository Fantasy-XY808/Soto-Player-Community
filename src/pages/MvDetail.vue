<script setup lang="ts">
import type { MvDetail } from "@/apis/mv/netease";
import { fetchMvDetail } from "@/apis/mv/netease";
import { useImagePreload } from "@/composables/useImagePreload";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

/** 路由参数中的 MV ID */
const mvId = computed(() => decodeURIComponent(String(route.params.id ?? "")));

/** URL query 兜底标题（详情未拉到时空标题） */
const fallbackName = computed(() => {
  const n = route.query.name;
  return typeof n === "string" ? n : "";
});

/** MV 详情 */
const detail = shallowRef<MvDetail | null>(null);
/** 加载中 */
const loading = ref(false);
/** 错误信息 */
const error = ref("");
/** 当前选择的分辨率（key 为 brs 的键） */
const currentRes = ref(0);

/**
 * 预加载封面：detail 拉到后立即开始解码，video 标签的 :poster 渲染时直接命中浏览器缓存，
 * 避免黑色闪屏。loaded 用于骨架屏→视频的淡入时机（这里只取预热副作用）。
 */
const coverUrl = computed(() => detail.value?.cover ?? "");
useImagePreload(coverUrl);

/** 可选分辨率降序（字符串形式以适配 STabs key 类型） */
const resolutions = computed<string[]>(() => {
  if (!detail.value) return [];
  return Object.keys(detail.value.brs)
    .map(Number)
    .filter((r) => Number.isFinite(r))
    .sort((a, b) => b - a)
    .map(String);
});

/** 当前播放 URL */
const currentUrl = computed(() => {
  if (!detail.value || !currentRes.value) return "";
  return detail.value.brs[currentRes.value] ?? "";
});

/** 格式化播放数 */
const formatPlayCount = (count?: number): string => {
  if (!count) return "";
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`;
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)}万`;
  return String(count);
};

/** 拉取详情，默认选最高分辨率 */
const load = async (): Promise<void> => {
  if (!mvId.value) return;
  loading.value = true;
  error.value = "";
  try {
    const data = await fetchMvDetail(mvId.value);
    if (!data) {
      error.value = t("mv.detail.notFound");
      return;
    }
    detail.value = data;
    if (resolutions.value.length > 0) {
      currentRes.value = Number(resolutions.value[0]);
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
};

/** 切换分辨率 */
const onResChange = (key: string | number | boolean): void => {
  currentRes.value = Number(key);
};

/** STabs 绑定值（字符串形式） */
const currentResTab = computed(() => String(currentRes.value));

/** 返回上一页 */
const goBack = (): void => {
  if (window.history.length > 1) router.back();
  else router.push({ name: "mv" });
};

/** 视频元素引用 */
const videoRef = ref<HTMLVideoElement | null>(null);

/** 自动播放（首次加载完成后） */
watch(currentUrl, (url) => {
  if (!url || !videoRef.value) return;
  videoRef.value.load();
  void videoRef.value.play().catch(() => {
    // 自动播放被浏览器拦截时静默忽略，用户手动点播放
  });
});

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
          {{ detail?.name ?? fallbackName ?? t("mv.detail.loading") }}
        </h1>
        <!-- 分辨率切换 -->
        <div v-if="resolutions.length > 1" class="shrink-0">
          <STabs
            :model-value="currentResTab"
            :tabs="resolutions.map((r) => ({ key: r, label: `${r}P` }))"
            type="segment"
            size="small"
            @update:model-value="onResChange"
          />
        </div>
      </div>
    </div>
    <!-- 内容 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <!-- 加载中：骨架屏占位，模拟视频 + 元信息布局 -->
      <div v-if="loading" class="mx-auto flex max-w-5xl flex-col gap-4">
        <SSkeleton class="aspect-video w-full rounded-xl" />
        <div class="flex flex-col gap-2">
          <SSkeleton class="h-5 w-2/3" />
          <SSkeleton class="h-4 w-1/3" />
        </div>
      </div>
      <!-- 错误态 -->
      <div v-else-if="error" class="flex h-full items-center justify-center">
        <div class="text-center text-red-500/85">
          <IconLucideTriangleAlert class="mx-auto mb-4 size-14 opacity-50" />
          <div class="text-sm font-medium mb-1">{{ t("mv.detail.errorTitle") }}</div>
          <div class="text-xs opacity-80 break-all max-w-sm">{{ error }}</div>
        </div>
      </div>
      <!-- 播放器 + 信息 -->
      <div v-else-if="detail" class="mx-auto flex max-w-5xl flex-col gap-4">
        <!-- 视频播放器 -->
        <div class="overflow-hidden rounded-xl bg-black">
          <video
            v-if="currentUrl"
            ref="videoRef"
            class="aspect-video w-full"
            controls
            autoplay
            :poster="detail.cover"
            :src="currentUrl"
          />
          <!-- 无 URL 兜底（可能 VIP 限制） -->
          <div v-else class="flex aspect-video w-full items-center justify-center text-white/70">
            <div class="text-center">
              <IconLucideLock class="mx-auto mb-3 size-12 opacity-60" />
              <div class="text-sm">{{ t("mv.detail.noUrl") }}</div>
            </div>
          </div>
        </div>
        <!-- 元信息 -->
        <div class="flex flex-col gap-1">
          <div class="text-lg font-semibold text-on-surface">{{ detail.name }}</div>
          <div
            class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-on-surface-variant/70"
          >
            <span>{{ detail.artistName }}</span>
            <span v-if="detail.playCount" class="flex items-center gap-1">
              <IconLucidePlay class="size-3.5" />
              {{ formatPlayCount(detail.playCount) }}
            </span>
          </div>
          <!-- 简介 -->
          <div
            v-if="detail.desc"
            class="mt-2 whitespace-pre-wrap text-sm text-on-surface-variant/60"
          >
            {{ detail.desc }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
