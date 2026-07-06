<script setup lang="ts">
import type { VideoResolution } from "@shared/types/video";
import Plyr from "plyr";
import "plyr/dist/plyr.css";
import { fetchVideoDetail, fetchVideoUrl } from "@/apis/video/netease";
import { useCopyText } from "@/composables/useCopyText";
import { toast } from "@/composables/useToast";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { copy } = useCopyText();

/** 路由参数中的视频 ID */
const videoId = computed(() => decodeURIComponent(String(route.params.id ?? "")));

/** URL query 兜底标题（详情未拉到时空标题） */
const fallbackName = computed(() => {
  const n = route.query.name;
  return typeof n === "string" ? n : "";
});

/** 视频详情 */
const detail = shallowRef<Awaited<ReturnType<typeof fetchVideoDetail>> | null>(null);
/** 当前播放 URL */
const currentUrl = ref("");
/** 当前分辨率 */
const currentRes = ref<VideoResolution>(1080);
/** 加载中 */
const loading = ref(false);
/** URL 加载中（切换画质时短时） */
const urlLoading = ref(false);
/** 错误信息 */
const error = ref("");
/** 点赞中 */
const liking = ref(false);
/** 收藏中 */
const collecting = ref(false);
/** 已点赞 */
const liked = ref(false);
/** 已收藏 */
const collected = ref(false);

/** 可选画质（降序） */
const qualities: { res: VideoResolution; label: string }[] = [
  { res: 1080, label: t("video.quality.high") },
  { res: 720, label: t("video.quality.medium") },
  { res: 480, label: t("video.quality.low") },
  { res: 240, label: t("video.quality.standard") },
];

/** 视频元素引用 */
const videoEl = ref<HTMLVideoElement | null>(null);
/** Plyr 实例 */
let player: Plyr | null = null;

/** 格式化播放数 */
const formatPlayCount = (count?: number): string => {
  if (!count) return "";
  if (count >= 100_000_000) return `${(count / 100_000_000).toFixed(1)}亿`;
  if (count >= 10_000) return `${(count / 10_000).toFixed(1)}万`;
  return String(count);
};

/** 视频分享 URL */
const shareUrl = computed(() => {
  if (!videoId.value) return "";
  return `https://music.163.com/#/video?id=${videoId.value}`;
});

/** 拉取视频详情 */
const loadDetail = async (): Promise<void> => {
  if (!videoId.value) return;
  loading.value = true;
  error.value = "";
  try {
    const data = await fetchVideoDetail(videoId.value);
    if (!data) {
      error.value = t("video.notFound");
      return;
    }
    detail.value = data;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
};

/** 拉取视频播放地址 */
const loadUrl = async (res: VideoResolution): Promise<void> => {
  if (!videoId.value) return;
  urlLoading.value = true;
  try {
    const result = await fetchVideoUrl(videoId.value, res);
    currentUrl.value = result?.url ?? "";
  } catch (err) {
    console.warn("[video] load url failed:", err);
    currentUrl.value = "";
  } finally {
    urlLoading.value = false;
  }
};

/**
 * 切换画质
 * @param res - 目标分辨率
 */
const switchQuality = (res: VideoResolution): void => {
  if (res === currentRes.value) return;
  currentRes.value = res;
  void loadUrl(res);
};

/** 返回上一页 */
const goBack = (): void => {
  if (window.history.length > 1) router.back();
  else router.push({ name: "home" });
};

/** 点赞 / 取消点赞（占位实现，无可用 video_like 接口时本地翻转） */
const onLike = async (): Promise<void> => {
  if (liking.value) return;
  liking.value = true;
  try {
    liked.value = !liked.value;
    toast.success(liked.value ? t("video.toast.liked") : t("video.toast.unliked"));
  } finally {
    liking.value = false;
  }
};

/** 收藏 / 取消收藏（占位实现，无可用 video_collect 接口时本地翻转） */
const onCollect = async (): Promise<void> => {
  if (collecting.value) return;
  collecting.value = true;
  try {
    collected.value = !collected.value;
    toast.success(
      collected.value ? t("video.toast.collected") : t("video.toast.uncollected"),
    );
  } finally {
    collecting.value = false;
  }
};

/** 复制视频分享链接 */
const onCopyLink = async (): Promise<void> => {
  await copy(shareUrl.value);
};

/** 当前 URL 变化时刷新视频源 */
watch(currentUrl, (url) => {
  if (!url || !videoEl.value) return;
  videoEl.value.src = url;
  videoEl.value.load();
  void videoEl.value.play().catch(() => {
    // 自动播放被拦截时静默忽略，用户手动点播放
  });
});

/** 详情拉到后加载默认画质的 URL */
watch(detail, (d) => {
  if (d) void loadUrl(currentRes.value);
});

onMounted(() => {
  // 视频播放时自动暂停音乐
  void window.api.player.pause();
  void loadDetail();
  if (videoEl.value) {
    player = new Plyr(videoEl.value, {
      controls: [
        "play-large",
        "play",
        "progress",
        "current-time",
        "mute",
        "volume",
        "settings",
        "pip",
        "airplay",
        "fullscreen",
      ],
      settings: ["speed"],
      ratio: "16:9",
      autoplay: true,
    });
  }
});

onBeforeUnmount(() => {
  player?.destroy();
  player = null;
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
          {{ detail?.name ?? fallbackName ?? t("video.loading") }}
        </h1>
        <!-- 画质切换 -->
        <div v-if="!error" class="shrink-0">
          <STabs
            :model-value="String(currentRes)"
            :tabs="qualities.map((q) => ({ key: String(q.res), label: q.label }))"
            type="segment"
            size="small"
            @update:model-value="(key) => switchQuality(Number(key) as VideoResolution)"
          />
        </div>
      </div>
    </div>
    <!-- 内容 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <!-- 加载中 -->
      <div v-if="loading" class="flex h-full items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="mx-auto mb-4 block text-4xl text-primary/70" />
          <div class="text-sm">{{ t("video.loading") }}</div>
        </div>
      </div>
      <!-- 错误态 -->
      <div v-else-if="error" class="flex h-full items-center justify-center">
        <div class="text-center text-red-500/85">
          <IconLucideTriangleAlert class="mx-auto mb-4 size-14 opacity-50" />
          <div class="text-sm font-medium mb-1">{{ t("video.errorTitle") }}</div>
          <div class="text-xs opacity-80 break-all max-w-sm">{{ error }}</div>
        </div>
      </div>
      <!-- 播放器 + 信息 -->
      <div v-else-if="detail" class="mx-auto flex max-w-5xl flex-col gap-4">
        <!-- 视频播放器 -->
        <div class="overflow-hidden rounded-xl bg-black">
          <video
            v-if="currentUrl"
            ref="videoEl"
            class="aspect-video w-full"
            crossorigin="anonymous"
            playsinline
            :poster="detail.cover"
          />
          <!-- 无 URL 兜底（VIP / 版权限制） -->
          <div v-else class="flex aspect-video w-full items-center justify-center text-white/70">
            <div class="text-center">
              <IconLucideLock v-if="!urlLoading" class="mx-auto mb-3 size-12 opacity-60" />
              <SLoading v-else class="mx-auto mb-3 block text-4xl text-white/60" />
              <div class="text-sm">
                {{ urlLoading ? t("video.loading") : t("video.noUrl") }}
              </div>
            </div>
          </div>
        </div>
        <!-- 元信息 -->
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-lg font-semibold text-on-surface">{{ detail.name }}</div>
              <div
                class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-on-surface-variant/70"
              >
                <span v-if="detail.artists.length > 0">
                  {{ detail.artists.map((a) => a.name).join(" / ") }}
                </span>
                <span v-if="detail.playTime" class="flex items-center gap-1">
                  <IconLucidePlay class="size-3.5" />
                  {{ formatPlayCount(detail.playTime) }}
                </span>
              </div>
            </div>
            <!-- 操作按钮 -->
            <div class="flex shrink-0 items-center gap-2">
              <SButton
                variant="secondary"
                size="small"
                circle
                :type="liked ? 'primary' : 'default'"
                :loading="liking"
                :aria-label="t('video.actions.like')"
                @click="onLike"
              >
                <template #icon><IconLucideThumbsUp /></template>
              </SButton>
              <SButton
                variant="secondary"
                size="small"
                circle
                :type="collected ? 'primary' : 'default'"
                :loading="collecting"
                :aria-label="t('video.actions.collect')"
                @click="onCollect"
              >
                <template #icon><IconLucidePlus /></template>
              </SButton>
              <SButton
                variant="secondary"
                size="small"
                circle
                :aria-label="t('video.actions.share')"
                @click="onCopyLink"
              >
                <template #icon><IconLucideLink /></template>
              </SButton>
            </div>
          </div>
          <!-- 标签 -->
          <div v-if="detail.tags.length > 0" class="flex flex-wrap items-center gap-2">
            <SButton v-for="tag in detail.tags" :key="tag.id" variant="tertiary" size="small" round>
              <template #icon><IconLucideTag /></template>
              {{ tag.name }}
            </SButton>
          </div>
          <!-- 简介 -->
          <div
            v-if="detail.description"
            class="whitespace-pre-wrap text-sm text-on-surface-variant/60"
          >
            {{ detail.description }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
