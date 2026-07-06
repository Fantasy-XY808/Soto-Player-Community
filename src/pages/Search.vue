<script setup lang="ts">
import type { Track } from "@shared/types/player";
import { ALL_PLATFORMS, PLATFORM_SHORT_NAME, type Platform } from "@shared/types/platform";
import type { CoverItem } from "@/types/artist";
import type { MvItem } from "@/apis/mv/netease";
import {
  searchSongs,
  searchAlbums,
  searchArtists,
  searchPlaylists,
  searchMvs,
} from "@/apis/search";
import SongList from "@/components/list/SongList.vue";
import CoverList from "@/components/list/CoverList.vue";
import { useStatusStore } from "@/stores/status";
import { navigateToAlbum, navigateToPlaylist, navigateToMv } from "@/utils/navigate";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const status = useStatusStore();

type TabKey = "songs" | "albums" | "artists" | "playlists" | "mvs";

const TAB_KEYS: readonly TabKey[] = ["songs", "albums", "artists", "playlists", "mvs"];

/** 当前 tab */
const activeTab = computed<TabKey>(() => {
  const tab = route.query.tab;
  // MV tab 仅网易云可用；切到其它平台时回退到 songs
  if (tab === "mvs" && status.searchPlatform !== "netease") return "songs";
  return typeof tab === "string" && (TAB_KEYS as readonly string[]).includes(tab)
    ? (tab as TabKey)
    : "songs";
});

const PAGE_SIZE = 50;

/** URL query 中的关键词 */
const keyword = computed(() => {
  const q = route.query.q;
  return typeof q === "string" ? q.trim() : "";
});

const tabs = computed(() => {
  const base = [
    { key: "songs", label: t("search.tabs.songs") },
    { key: "albums", label: t("search.tabs.albums") },
    { key: "artists", label: t("search.tabs.artists") },
    { key: "playlists", label: t("search.tabs.playlists") },
  ];
  // MV 搜索仅网易云支持，仅在该平台展示 tab
  if (status.searchPlatform === "netease") {
    base.push({ key: "mvs", label: t("search.tabs.mvs") });
  }
  return base;
});

const platformTabs = ALL_PLATFORMS.map((key) => ({ key, label: PLATFORM_SHORT_NAME[key] }));

interface TabState<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
}

const createState = <T,>(): TabState<T> => ({
  items: [],
  total: 0,
  hasMore: false,
  loaded: false,
  loading: false,
  loadingMore: false,
});

const states = reactive({
  songs: createState<Track>(),
  albums: createState<CoverItem>(),
  artists: createState<CoverItem>(),
  playlists: createState<CoverItem>(),
  mvs: createState<MvItem>(),
});

const error = ref("");

/** 派发到 apis 层的统一调用 */
const fetchers = {
  songs: searchSongs,
  albums: searchAlbums,
  artists: searchArtists,
  playlists: searchPlaylists,
  mvs: searchMvs,
} as const;

/**
 * 拉取指定 tab
 * @param tab - 要拉取的 tab
 * @param append - 是否追加下一页
 */
const fetchTab = async (tab: TabKey, append: boolean): Promise<void> => {
  if (!keyword.value) return;
  const state = states[tab];
  if (append) {
    if (!state.loaded || state.loadingMore || !state.hasMore) return;
    state.loadingMore = true;
  } else {
    if (state.loading) return;
    state.loading = true;
  }
  error.value = "";
  try {
    const offset = append ? state.items.length : 0;
    const result = await (fetchers[tab] as typeof searchSongs)(
      status.searchPlatform,
      keyword.value,
      offset,
      PAGE_SIZE,
    );
    const items = result.items.map((item) => markRaw(item));
    if (append) {
      (state.items as Track[]).push(...(items as Track[]));
    } else {
      state.items = items as Track[];
    }
    state.total = result.total;
    state.hasMore = result.hasMore;
    state.loaded = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    state.loading = false;
    state.loadingMore = false;
  }
};

const resetStates = (): void => {
  (Object.keys(states) as TabKey[]).forEach((tab) => {
    states[tab].items = [];
    states[tab].total = 0;
    states[tab].hasMore = false;
    states[tab].loaded = false;
    states[tab].loading = false;
    states[tab].loadingMore = false;
  });
  error.value = "";
};

/** 关键词变化：清空状态并拉当前 tab */
watch(
  keyword,
  () => {
    resetStates();
    if (keyword.value) fetchTab(activeTab.value, false);
  },
  { immediate: true },
);

/** 平台切换：清空状态并按当前关键词重拉 */
watch(
  () => status.searchPlatform,
  () => {
    resetStates();
    if (keyword.value) fetchTab(activeTab.value, false);
  },
);

/** 切换 tab：未拉过则按需请求 */
watch(activeTab, (tab) => {
  if (keyword.value && !states[tab].loaded) fetchTab(tab, false);
});

const onTabSwitch = (key: string): void => {
  router.replace({ query: { ...route.query, tab: key } });
};

const onPlatformSwitch = (key: string): void => {
  status.searchPlatform = key as Platform;
};

/** 滚动触底加载下一页 */
const onReachBottom = (tab: TabKey): void => {
  fetchTab(tab, true);
};

/** MV 网格滚动触底（无虚拟滚动，需手动监听） */
const onMvGridScroll = (e: Event): void => {
  const el = e.target as HTMLElement;
  if (
    el.scrollHeight - el.scrollTop - el.clientHeight < 240 &&
    states.mvs.hasMore &&
    !states.mvs.loadingMore
  ) {
    onReachBottom("mvs");
  }
};

/** 当前 tab 首屏加载中 */
const isInitialLoading = computed(() => {
  const state = states[activeTab.value];
  return state.loading && !state.loaded;
});

/** 当前 tab 已加载且为空 */
const isEmptyResult = computed(() => {
  const state = states[activeTab.value];
  return state.loaded && state.items.length === 0;
});
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <div class="shrink-0 px-5 pb-2">
      <div class="mt-2 mb-4 flex items-end justify-between gap-4">
        <h1 class="truncate min-w-0">
          <span class="text-3xl font-bold text-on-surface">
            {{ keyword || t("search.title") }}
          </span>
          <span v-if="keyword" class="ml-2 font-medium text-lg text-on-surface-variant/60">
            {{ t("search.titleSuffix") }}
          </span>
        </h1>
        <!-- 平台切换 -->
        <div class="shrink-0 w-52">
          <STabs
            :model-value="status.searchPlatform"
            :tabs="platformTabs"
            type="segment"
            round
            @update:model-value="onPlatformSwitch"
          />
        </div>
      </div>
      <STabs :model-value="activeTab" :tabs="tabs" @update:model-value="onTabSwitch" />
    </div>
    <!-- 空关键词 -->
    <div v-if="!keyword" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideSearch class="size-14 mx-auto mb-4 opacity-30" />
        <div class="text-sm">{{ t("search.emptyKeyword") }}</div>
      </div>
    </div>
    <!-- 错误态 -->
    <div v-else-if="error" class="flex-1 flex items-center justify-center px-6">
      <div class="text-center text-red-500/85">
        <IconLucideTriangleAlert class="size-14 mx-auto mb-4 opacity-50" />
        <div class="text-sm font-medium mb-1">{{ t("search.errorTitle") }}</div>
        <div class="text-xs opacity-80 break-all max-w-xs">{{ error }}</div>
      </div>
    </div>
    <!-- 首次加载：骨架屏占位，比旋转图标更接近最终布局 -->
    <div v-else-if="isInitialLoading" class="flex-1 min-h-0 px-5 py-3">
      <div class="flex flex-col gap-2">
        <SSkeleton v-for="i in 8" :key="i" class="h-22" />
      </div>
    </div>
    <!-- 无结果 -->
    <div v-else-if="isEmptyResult" class="flex-1 flex items-center justify-center">
      <div class="text-center text-on-surface-variant/60">
        <IconLucideSearchX class="size-14 mx-auto mb-4 opacity-30" />
        <div class="text-sm mb-1">{{ t("search.noResults") }}</div>
        <div class="text-xs opacity-70">{{ t("search.noResultsHint") }}</div>
      </div>
    </div>
    <!-- 各 tab 内容 -->
    <div v-else class="flex-1 min-h-0">
      <SongList
        v-if="activeTab === 'songs'"
        :items="states.songs.items"
        :source="status.searchPlatform"
        :show-size="false"
        :has-more="states.songs.hasMore"
        :loading-more="states.songs.loadingMore"
        @reach-bottom="onReachBottom('songs')"
      />
      <CoverList
        v-else-if="activeTab === 'albums'"
        :items="states.albums.items"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.albums.hasMore"
        :loading-more="states.albums.loadingMore"
        @click="
          (item) => navigateToAlbum(item.title, { source: status.searchPlatform, albumId: item.id })
        "
        @reach-bottom="onReachBottom('albums')"
      />
      <CoverList
        v-else-if="activeTab === 'artists'"
        :items="states.artists.items"
        type="artist"
        :min-size="120"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.artists.hasMore"
        :loading-more="states.artists.loadingMore"
        @reach-bottom="onReachBottom('artists')"
      />
      <CoverList
        v-else-if="activeTab === 'playlists'"
        :items="states.playlists.items"
        :padding-x="20"
        :padding-top="8"
        :padding-bottom="20"
        :has-more="states.playlists.hasMore"
        :loading-more="states.playlists.loadingMore"
        @click="
          (item) => navigateToPlaylist(item.id, { source: status.searchPlatform, name: item.title })
        "
        @reach-bottom="onReachBottom('playlists')"
      />
      <!-- MV 网格（与 MvBrowse 同款卡片，点击跳转详情） -->
      <div v-else class="min-h-0 flex-1 overflow-y-auto" @scroll="onMvGridScroll">
        <div class="grid grid-cols-2 gap-4 px-5 pb-6 md:grid-cols-3 lg:grid-cols-4">
          <div
            v-for="mv in states.mvs.items"
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
            </div>
            <div class="truncate text-sm font-medium text-on-surface">{{ mv.name }}</div>
            <div class="truncate text-xs text-on-surface-variant/50">{{ mv.artistName }}</div>
          </div>
        </div>
        <div v-if="states.mvs.hasMore" class="flex justify-center py-4">
          <SLoading v-if="states.mvs.loadingMore" class="text-2xl text-primary/70" />
        </div>
      </div>
    </div>
  </div>
</template>
