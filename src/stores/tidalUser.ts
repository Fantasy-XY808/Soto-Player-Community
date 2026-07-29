import type { TidalProfile } from "@shared/types/tidal";

/**
 * Tidal 账户 store
 *
 * 与 qobuzUser 之不同：
 * - 鉴权用 OAuth 2.0 + PKCE（access_token + refresh_token），不是 user_auth_token
 * - profile 含订阅等级（free / hifi / hifi_plus）
 * - free 账号只能拿 AAC 96kbps，hifi 才能拿 16bit FLAC，hifi_plus 才能拿 24bit MQA
 * - access_token 1 小时过期，主进程自动刷新（剩余 < 5 分钟时触发）
 *
 * 注：profile 持久化到 localStorage，启动时直接展示，再异步 fetchStatus 刷新
 */
export const useTidalUserStore = defineStore(
  "tidalUser",
  () => {
    /** 用户资料；null 表示未登录 */
    const profile = shallowRef<TidalProfile | null>(null);
    /** 上次刷新用户内容时间戳（ms） */
    const lastRefreshAt = ref<number>(0);
    /** 是否已登录 */
    const isLoggedIn = computed(() => profile.value !== null);
    /** 是否付费订阅（hifi / hifi_plus 才能播放完整 Hi-Res） */
    const isSubscribed = computed(
      () => profile.value?.subscription === "hifi" || profile.value?.subscription === "hifi_plus",
    );
    /** fetchStatus 失败标志，用于 UI 提示 token 可能已失效 */
    const statusError = ref(false);

    /**
     * 用主进程持有的 access_token 验证登录态
     * @returns true 表示登录态有效；false 表示未登录或 token 失效
     */
    const fetchStatus = async (): Promise<boolean> => {
      try {
        const res = await window.api.tidal.fetchStatus();
        if (res.ok) {
          profile.value = res.profile;
          statusError.value = false;
          return true;
        }
        profile.value = null;
        statusError.value = true;
        return false;
      } catch {
        statusError.value = true;
        return profile.value !== null;
      }
    };

    /**
     * 拉取用户收藏 / 歌单列表
     *
     * Tidal 的 favorite/playlist API 需另起调研，当前仅占位，保留旧值
     */
    const fetchUserContent = async (): Promise<void> => {
      if (!isLoggedIn.value) return;
      lastRefreshAt.value = Date.now();
    };

    /** 退出登录：清主进程 token + 清本地 profile */
    const logout = async (): Promise<void> => {
      await window.api.tidal.clearToken();
      profile.value = null;
      lastRefreshAt.value = 0;
      statusError.value = false;
    };

    return {
      profile,
      lastRefreshAt,
      isLoggedIn,
      isSubscribed,
      statusError,
      fetchStatus,
      fetchUserContent,
      logout,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["profile", "lastRefreshAt"],
    },
  },
);
