<script setup lang="ts">
import type { EventItem } from "@/apis/event/netease";
import { getCachedEvent, fetchEvents } from "@/apis/event/netease";
import { songsByIds } from "@/apis/song/netease";
import { playNow } from "@/core/player";
import { toast } from "@/composables/useToast";
import { navigateToMv, navigateToVideo } from "@/utils/navigate";
import i18n from "@/i18n";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

/** 路由参数中的动态 ID */
const eventId = computed(() => decodeURIComponent(String(route.params.id ?? "")));

/** 当前动态 */
const event = shallowRef<EventItem | null>(null);
/** 加载中 */
const loading = ref(false);

/**
 * 加载动态：优先从缓存读，未命中则拉首页查找
 * 简化方案：不调额外详情接口，缓存未命中时仅能展示已知信息
 */
const loadEvent = async (): Promise<void> => {
  if (!eventId.value) return;
  const cached = getCachedEvent(eventId.value);
  if (cached) {
    event.value = cached;
    return;
  }
  loading.value = true;
  try {
    const res = await fetchEvents(-1, 20);
    event.value = res.events.find((item) => item.id === eventId.value) ?? null;
  } catch (error) {
    console.warn("[event-detail] load failed:", error);
  } finally {
    loading.value = false;
  }
};

/** 解析动态 JSON 取主要内容 */
const parseEvent = (
  item: EventItem | null,
): {
  text: string;
  cover?: string;
  title?: string;
  refType?: "song" | "playlist" | "album" | "video" | "mv";
  refId?: string;
} => {
  if (!item?.json) return { text: "" };
  try {
    const parsed = JSON.parse(item.json);
    if (parsed?.song?.id) {
      return {
        text: parsed?.msg || parsed?.json?.msg || "",
        cover: parsed?.song?.album?.picUrl,
        title: parsed?.song?.name,
        refType: "song",
        refId: String(parsed.song.id),
      };
    }
    if (parsed?.video?.videoId) {
      return {
        text: parsed?.msg || parsed?.json?.msg || "",
        cover: parsed?.video?.coverUrl,
        title: parsed?.video?.title,
        refType: "video",
        refId: String(parsed.video.videoId),
      };
    }
    if (parsed?.mv?.id) {
      return {
        text: parsed?.msg || parsed?.json?.msg || "",
        cover: parsed?.mv?.cover,
        title: parsed?.mv?.name,
        refType: "mv",
        refId: String(parsed.mv.id),
      };
    }
    if (parsed?.playlist?.id) {
      return {
        text: parsed?.msg || parsed?.json?.msg || "",
        cover: parsed?.playlist?.coverImgUrl,
        title: parsed?.playlist?.name,
        refType: "playlist",
        refId: String(parsed.playlist.id),
      };
    }
    if (parsed?.album?.id) {
      return {
        text: parsed?.msg || parsed?.json?.msg || "",
        cover: parsed?.album?.picUrl,
        title: parsed?.album?.name,
        refType: "album",
        refId: String(parsed.album.id),
      };
    }
    return { text: parsed?.msg || parsed?.json?.msg || "" };
  } catch {
    return { text: "" };
  }
};

/** 引用条目图标类型 */
const refIcon = (refType?: string): string => {
  if (refType === "video" || refType === "mv") return "video";
  if (refType === "playlist") return "list";
  if (refType === "album") return "disc";
  return "music";
};

/** 点击引用条目 */
const onRefClick = async (): Promise<void> => {
  if (!event.value) return;
  const parsed = parseEvent(event.value);
  if (!parsed.refType || !parsed.refId) return;
  switch (parsed.refType) {
    case "song":
      try {
        const tracks = await songsByIds([parsed.refId]);
        const track = tracks[0];
        if (!track) {
          toast.info(i18n.global.t("common.unavailable"));
          return;
        }
        await playNow(track);
      } catch (error) {
        console.warn("[event-detail] play song failed:", error);
        toast.info(i18n.global.t("common.unavailable"));
      }
      return;
    case "video":
      navigateToVideo(parsed.refId, { name: parsed.title });
      return;
    case "mv":
      navigateToMv(parsed.refId, { name: parsed.title });
      return;
    case "playlist":
    case "album":
      router.push({
        name: "collection",
        params: { source: "netease", type: parsed.refType, id: parsed.refId },
      });
      return;
  }
};

/** 返回上一页 */
const goBack = (): void => {
  if (window.history.length > 1) router.back();
  else router.push({ name: "events" });
};

/** 格式化时间 */
const formatTime = (ts: number): string => {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
};

watch(eventId, () => void loadEvent(), { immediate: true });
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
          {{ t("events.detailTitle") }}
        </h1>
      </div>
    </div>
    <!-- 内容 -->
    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
      <!-- 加载中 -->
      <div v-if="loading" class="flex h-full items-center justify-center">
        <div class="text-center text-on-surface-variant/60">
          <SLoading class="mx-auto mb-4 block text-4xl text-primary/70" />
          <div class="text-sm">{{ t("common.loading") }}</div>
        </div>
      </div>
      <!-- 未找到 -->
      <div v-else-if="!event" class="flex h-full items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideNewspaper class="mx-auto mb-3 size-12 opacity-30" />
          <div class="text-sm">{{ t("events.notFound") }}</div>
        </div>
      </div>
      <!-- 详情 -->
      <div v-else class="mx-auto flex max-w-[800px] flex-col gap-4">
        <SCard radius="lg" class="flex gap-4 p-5">
          <SImg
            :src="event.userAvatar"
            :alt="event.userName"
            class="size-16 shrink-0 rounded-full"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-baseline justify-between gap-2">
              <span class="truncate text-base font-medium text-on-surface">
                {{ event.userName }}
              </span>
              <span class="shrink-0 text-xs text-on-surface-variant/40">
                {{ formatTime(event.actualTime) }}
              </span>
            </div>
            <p
              v-if="parseEvent(event).text"
              class="mt-2 text-sm text-on-surface-variant/90 whitespace-pre-wrap break-words"
            >
              {{ parseEvent(event).text }}
            </p>
            <!-- 引用实体 -->
            <div
              v-if="parseEvent(event).title"
              class="mt-3 flex cursor-pointer items-center gap-3 rounded-lg bg-on-surface/5 px-3 py-2.5 transition-colors hover:bg-primary/10"
              @click="onRefClick()"
            >
              <SImg
                v-if="parseEvent(event).cover"
                :src="parseEvent(event).cover"
                :alt="parseEvent(event).title"
                class="size-12 shrink-0 rounded-md object-cover"
              />
              <div class="min-w-0 flex-1 flex items-center gap-2">
                <IconLucideVideo
                  v-if="refIcon(parseEvent(event).refType) === 'video'"
                  class="size-4 shrink-0 text-primary/60"
                />
                <IconLucideListMusic
                  v-else-if="refIcon(parseEvent(event).refType) === 'list'"
                  class="size-4 shrink-0 text-primary/60"
                />
                <IconLucideDisc
                  v-else-if="refIcon(parseEvent(event).refType) === 'disc'"
                  class="size-4 shrink-0 text-primary/60"
                />
                <IconLucideMusic v-else class="size-4 shrink-0 text-primary/60" />
                <span class="truncate text-sm text-on-surface-variant">
                  {{ parseEvent(event).title }}
                </span>
              </div>
            </div>
            <!-- 互动数据 -->
            <div class="mt-3 flex items-center gap-4 text-xs text-on-surface-variant/60">
              <span v-if="event.likeCount !== undefined" class="flex items-center gap-1">
                <IconLucideThumbsUp class="size-3.5" />
                {{ event.likeCount }}
              </span>
              <span v-if="event.commentCount !== undefined" class="flex items-center gap-1">
                <IconLucideMessageCircle class="size-3.5" />
                {{ event.commentCount }}
              </span>
            </div>
          </div>
        </SCard>
      </div>
    </div>
  </div>
</template>
