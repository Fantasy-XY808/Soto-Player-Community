<script setup lang="ts">
import type { EventItem } from "@/apis/event/netease";
import { fetchEvents } from "@/apis/event/netease";
import { songsByIds } from "@/apis/song/netease";
import { useUserStore } from "@/stores/user";
import { playNow } from "@/core/player";
import { toast } from "@/composables/useToast";
import { navigateToEvent, navigateToMv, navigateToVideo } from "@/utils/navigate";
import i18n from "@/i18n";

const { t } = useI18n();
const user = useUserStore();
const router = useRouter();

/** 动态列表 */
const events = shallowRef<EventItem[]>([]);
/** 下一页游标 */
const lasttime = ref(-1);
/** 是否还有更多 */
const hasMore = ref(false);
/** 加载中 */
const loading = ref(false);

/** 加载首页 */
const loadFirst = async (): Promise<void> => {
  if (!user.isLoggedIn) return;
  loading.value = true;
  events.value = [];
  lasttime.value = -1;
  try {
    const res = await fetchEvents(-1, 20);
    events.value = res.events;
    lasttime.value = res.lasttime;
    hasMore.value = res.more;
  } catch (error) {
    console.warn("[events] load failed:", error);
  } finally {
    loading.value = false;
  }
};

/** 加载更多 */
const loadMore = async (): Promise<void> => {
  if (!hasMore.value || loading.value || lasttime.value === -1) return;
  loading.value = true;
  try {
    const res = await fetchEvents(lasttime.value, 20);
    events.value = [...events.value, ...res.events];
    lasttime.value = res.lasttime;
    hasMore.value = res.more;
  } catch (error) {
    console.warn("[events] load more failed:", error);
  } finally {
    loading.value = false;
  }
};

/** 解析动态 JSON 取主要内容 */
const parseEvent = (
  item: EventItem,
): {
  text: string;
  cover?: string;
  title?: string;
  refType?: "song" | "playlist" | "album" | "video" | "mv";
  refId?: string;
} => {
  try {
    const parsed = JSON.parse(item.json);
    // 引用实体优先级：song > video > mv > playlist > album
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

/** 引用条目图标 */
const refIcon = (refType?: string): string => {
  if (refType === "video" || refType === "mv") return "video";
  if (refType === "playlist") return "list";
  if (refType === "album") return "disc";
  return "music";
};

/** 点击引用条目：song 直接播放，video/mv 跳播放页，playlist/album 跳详情页 */
const onRefClick = async (item: EventItem): Promise<void> => {
  const parsed = parseEvent(item);
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
        console.warn("[events] play song failed:", error);
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

/** 点击动态卡片进入详情页 */
const onCardClick = (event: EventItem): void => {
  navigateToEvent(event.id);
};

/** 格式化时间 */
const formatTime = (ts: number): string => {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
};

watch(
  () => user.isLoggedIn,
  (loggedIn) => {
    if (loggedIn) void loadFirst();
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pt-2 pb-3">
      <div class="flex items-center gap-5">
        <div
          class="flex size-28 shrink-0 items-center justify-center rounded-2xl border border-solid border-primary/15 bg-primary/8"
        >
          <IconLucideNewspaper class="size-12 text-primary/60" />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2">
          <h1 class="text-3xl font-bold text-on-surface text-balance">{{ t("events.title") }}</h1>
          <p class="text-sm text-on-surface-variant/70">{{ t("events.subtitle") }}</p>
        </div>
      </div>
    </div>
    <!-- 内容 -->
    <Transition name="fade" mode="out-in" :duration="150">
      <!-- 未登录 -->
      <div v-if="!user.isLoggedIn" key="login" class="flex flex-1 items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideNewspaper class="mx-auto mb-3 size-12 opacity-30" />
          <div class="text-sm">{{ t("events.needLogin") }}</div>
        </div>
      </div>
      <!-- 加载中（首屏）：骨架屏占位，模拟卡片布局 -->
      <div
        v-else-if="loading && events.length === 0"
        key="loading"
        class="min-h-0 flex-1 overflow-y-auto"
      >
        <div class="mx-auto flex max-w-[1000px] flex-col gap-4 px-5 pb-6">
          <SCard v-for="i in 4" :key="i" radius="lg" class="flex gap-3 p-4">
            <SSkeleton type="circle" class="size-12 shrink-0" />
            <div class="min-w-0 flex-1 flex flex-col gap-2 py-1">
              <SSkeleton type="lines" :lines="2" />
            </div>
          </SCard>
        </div>
      </div>
      <!-- 动态列表 -->
      <div v-else-if="events.length > 0" key="list" class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex max-w-[1000px] flex-col gap-4 px-5 pb-6">
          <SCard
            v-for="event in events"
            :key="event.id"
            radius="lg"
            class="flex gap-3 p-4 cursor-pointer transition-colors hover:bg-on-surface/3"
            @click="onCardClick(event)"
          >
            <SImg
              :src="parseEvent(event).cover || event.userAvatar"
              :alt="event.userName"
              class="size-12 shrink-0 rounded-full"
            />
            <div class="min-w-0 flex-1">
              <div class="flex items-baseline justify-between gap-2">
                <span class="truncate text-sm font-medium text-on-surface">
                  {{ event.userName }}
                </span>
                <span class="shrink-0 text-xs text-on-surface-variant/40">
                  {{ formatTime(event.actualTime) }}
                </span>
              </div>
              <p
                v-if="parseEvent(event).text"
                class="mt-1 text-sm text-on-surface-variant/80 line-clamp-3"
              >
                {{ parseEvent(event).text }}
              </p>
              <div
                v-if="parseEvent(event).title"
                class="mt-2 flex cursor-pointer items-center gap-2 rounded-lg bg-on-surface/5 px-3 py-2 transition-colors hover:bg-primary/10"
                @click.stop="onRefClick(event)"
              >
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
                <span class="truncate text-sm text-on-surface-variant/70">
                  {{ parseEvent(event).title }}
                </span>
              </div>
            </div>
          </SCard>
          <!-- 加载更多 -->
          <div v-if="hasMore" class="flex justify-center py-4">
            <SButton variant="secondary" round :loading="loading" @click="loadMore">
              {{ t("common.loadMore") }}
            </SButton>
          </div>
        </div>
      </div>
      <!-- 空状态 -->
      <div v-else key="empty" class="flex flex-1 items-center justify-center">
        <div class="text-center text-on-surface-variant/50">
          <IconLucideNewspaper class="mx-auto mb-3 size-12 opacity-30" />
          <div class="text-sm">{{ t("events.empty") }}</div>
        </div>
      </div>
    </Transition>
  </div>
</template>
