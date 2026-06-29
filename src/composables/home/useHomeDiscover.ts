import type { CoverItem } from "@/types/artist";
import type { Track } from "@shared/types/player";
import { useUserStore } from "@/stores/user";
import {
  fetchRecommendPlaylists,
  fetchRadarPlaylists,
  fetchArtists,
  fetchNewAlbums,
} from "@/apis/recommend/netease";
import { fetchToplists, fetchNewSongs } from "@/apis/discover/netease";
import { netease as neteaseApi } from "@/apis/netease";

/** 首页推荐内容缓存有效期 */
const CACHE_TTL = 30 * 60 * 1000;

/** 首页推荐内容缓存 */
interface DiscoverCache {
  at: number;
  loggedIn: boolean;
  recommend: CoverItem[];
  radar: CoverItem[];
  artists: CoverItem[];
  albums: CoverItem[];
  toplists: CoverItem[];
  playlistSquare: CoverItem[];
  newSongs: Track[];
}

/** 模块级缓存，跨页面 / 重新挂载复用 */
let cache: DiscoverCache | null = null;

/** 包裹拉取：失败记日志并回退空数组，单区块失败不影响整体 */
const safe = (label: string, task: Promise<CoverItem[]>): Promise<CoverItem[]> =>
  task.catch((error) => {
    console.warn(`[home] ${label} failed:`, error);
    return [];
  });

/** 包裹拉取（Track 版本） */
const safeTracks = (label: string, task: Promise<Track[]>): Promise<Track[]> =>
  task.catch((error) => {
    console.warn(`[home] ${label} failed:`, error);
    return [];
  });

/** 歌单广场原始结构 */
interface RawPlaylist {
  id: number | string;
  name: string;
  picUrl?: string;
  copywriter?: string;
  trackCount?: number;
}

/** 歌单广场（直接调用 personalized，不过滤雷达） */
const fetchPlaylistSquare = async (): Promise<CoverItem[]> => {
  const body = await neteaseApi.personalized<{ result?: RawPlaylist[] }>({ limit: 30 });
  return (body?.result ?? []).slice(0, 12).map((raw) => ({
    id: String(raw.id),
    title: raw.name,
    cover: raw.picUrl ?? "",
    subtitle: raw.copywriter || undefined,
    trackCount: raw.trackCount ?? 0,
  }));
};

/**
 * 首页推荐内容
 *
 * 聚合「推荐歌单 / 雷达 / 歌手 / 新碟 / 排行榜 / 歌单广场 / 新歌速递」区块
 * 命中缓存（30 分钟内、登录态一致）直接复用，避免重新挂载首页时重复请求
 */
export const useHomeDiscover = () => {
  const { t } = useI18n();
  const user = useUserStore();

  /** 推荐歌单 / 专属歌单 */
  const recommendPlaylists = shallowRef<CoverItem[]>([]);
  /** 雷达歌单 */
  const radarPlaylists = shallowRef<CoverItem[]>([]);
  /** 歌手推荐 */
  const artists = shallowRef<CoverItem[]>([]);
  /** 新碟上架 */
  const newAlbums = shallowRef<CoverItem[]>([]);
  /** 排行榜 */
  const toplists = shallowRef<CoverItem[]>([]);
  /** 歌单广场 */
  const playlistSquare = shallowRef<CoverItem[]>([]);
  /** 新歌速递 */
  const newSongs = shallowRef<Track[]>([]);

  /** 推荐歌单标题 */
  const recommendTitle = computed(() =>
    user.isLoggedIn ? t("home.recommend.title") : t("home.recommend.titleGuest"),
  );
  /** 推荐歌单副标题 */
  const recommendSubtitle = computed(() =>
    user.isLoggedIn ? t("home.recommend.subtitle") : t("home.recommend.subtitleGuest"),
  );

  /** 用缓存填充各区块 */
  const apply = (data: DiscoverCache): void => {
    recommendPlaylists.value = data.recommend;
    radarPlaylists.value = data.radar;
    artists.value = data.artists;
    newAlbums.value = data.albums;
    toplists.value = data.toplists;
    playlistSquare.value = data.playlistSquare;
    newSongs.value = data.newSongs;
  };

  /** 拉取首页推荐内容 */
  const load = async (): Promise<void> => {
    const loggedIn = user.isLoggedIn;
    if (cache && cache.loggedIn === loggedIn && Date.now() - cache.at < CACHE_TTL) {
      apply(cache);
      return;
    }
    const [recommend, radar, artistList, albums, toplistList, square, songs] = await Promise.all([
      safe("recommend playlists", fetchRecommendPlaylists(loggedIn)),
      loggedIn ? safe("radar playlists", fetchRadarPlaylists()) : Promise.resolve<CoverItem[]>([]),
      safe("artists", fetchArtists()),
      safe("new albums", fetchNewAlbums()),
      safe("toplists", fetchToplists()),
      safe("playlist square", fetchPlaylistSquare()),
      safeTracks("new songs", fetchNewSongs(0, 12)),
    ]);
    cache = {
      at: Date.now(),
      loggedIn,
      recommend,
      radar,
      artists: artistList,
      albums,
      toplists: toplistList,
      playlistSquare: square,
      newSongs: songs,
    };
    apply(cache);
  };

  // 登录态变化
  watch(
    () => user.isLoggedIn,
    () => {
      void load();
    },
  );

  return {
    recommendPlaylists,
    recommendTitle,
    recommendSubtitle,
    radarPlaylists,
    artists,
    newAlbums,
    toplists,
    playlistSquare,
    newSongs,
    load,
  };
};
