import type { QqmusicProfile } from "@shared/types/qqmusic";
import type { QqPlaylist } from "@/types/user";

/**
 * QQ 音乐账户 store
 *
 * - cookie 由主进程 safeStorage 加密落盘，渲染层不持有
 * - profile 持久化到 localStorage，启动时直接展示，再异步 fetchStatus 刷新
 * - 红心 / 歌单按需拉取；接口不可用时不阻塞主流程
 *
 * 注：likedSongIds 持久化为数组（JSON 无法直接序列化 Set），
 * 通过 likedSongIdSet 派生 Set 提供 O(1) 查询
 */
export const useQqUserStore = defineStore(
  "qqUser",
  () => {
    /** 用户资料；null 表示未登录 */
    const profile = ref<QqmusicProfile | null>(null);
    /** 红心歌曲 songmid 列表（持久化数组形式） */
    const likedSongIds = ref<string[]>([]);
    /** 红心集合视图（O(1) 查询，从 likedSongIds 派生） */
    const likedSongIdSet = computed(() => new Set(likedSongIds.value));
    /** 用户歌单 */
    const playlists = shallowRef<QqPlaylist[]>([]);
    /** 上次刷新用户内容时间戳（ms） */
    const lastRefreshAt = ref<number>(0);
    /** 是否已登录 */
    const isLoggedIn = computed(() => profile.value !== null);
    /** 是否 VIP（vipType 非 0） */
    const isVip = computed(() => !!profile.value?.vipType && profile.value.vipType !== 0);
    /** fetchStatus 失败标志，用于 UI 提示 cookie 可能已失效 */
    const statusError = ref(false);

    /**
     * 用主进程持有的 cookie 验证登录态
     * @returns true 表示登录态有效；false 表示未登录或 cookie 失效
     */
    const fetchStatus = async (): Promise<boolean> => {
      try {
        const res = await window.api.qqmusic.fetchStatus();
        if (res.ok) {
          profile.value = res.profile;
          statusError.value = false;
          return true;
        }
        profile.value = null;
        statusError.value = true;
        return false;
      } catch {
        // 网络异常保留缓存 profile，不强制清空（离线可用性）
        statusError.value = true;
        return profile.value !== null;
      }
    };

    /**
     * 拉取红心歌曲 id 集合
     *
     * QQ 音乐未公开稳定接口；当前仅占位，保留旧值
     */
    const fetchLikedSongIds = async (): Promise<void> => {
      if (!isLoggedIn.value) return;
      // 接口未稳定支持，预留入口供后续接入
    };

    /**
     * 拉取用户歌单列表
     *
     * QQ 音乐未公开稳定接口；当前仅占位，保留旧值
     */
    const fetchPlaylists = async (): Promise<void> => {
      if (!isLoggedIn.value) return;
      lastRefreshAt.value = Date.now();
    };

    /** 退出登录：清主进程 cookie + 清本地 profile 与用户内容 */
    const logout = async (): Promise<void> => {
      await window.api.qqmusic.clearCookie();
      profile.value = null;
      likedSongIds.value = [];
      playlists.value = [];
      lastRefreshAt.value = 0;
      statusError.value = false;
    };

    return {
      profile,
      likedSongIds,
      likedSongIdSet,
      playlists,
      lastRefreshAt,
      isLoggedIn,
      isVip,
      statusError,
      fetchStatus,
      fetchLikedSongIds,
      fetchPlaylists,
      logout,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["profile", "likedSongIds", "playlists", "lastRefreshAt"],
    },
  },
);
