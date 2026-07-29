import type { QobuzProfile } from "@shared/types/qobuz";

/**
 * Qobuz 账户 store
 *
 * 与 kugou 之不同：
 * - 鉴权用 user_auth_token（safeStorage 加密），不是 cookie
 * - profile 含订阅等级（free / studio_premier / studio_sublime）
 * - free 账号只能拿 30s preview，需订阅才能播放完整 Hi-Res
 * - 红心 / 歌单 Qobuz 公开 API 不稳定，按需拉取且不阻塞主流程
 *
 * 注：profile 持久化到 localStorage，启动时直接展示，再异步 fetchStatus 刷新
 */
export const useQobuzUserStore = defineStore(
  "qobuzUser",
  () => {
    /** 用户资料；null 表示未登录 */
    const profile = shallowRef<QobuzProfile | null>(null);
    /** 上次刷新用户内容时间戳（ms） */
    const lastRefreshAt = ref<number>(0);
    /** 是否已登录 */
    const isLoggedIn = computed(() => profile.value !== null);
    /** 是否付费订阅（studio_premier / studio_sublime 才能播放完整 Hi-Res） */
    const isSubscribed = computed(
      () =>
        profile.value?.subscription === "studio_premier" ||
        profile.value?.subscription === "studio_sublime",
    );
    /** fetchStatus 失败标志，用于 UI 提示 token 可能已失效 */
    const statusError = ref(false);

    /**
     * 用主进程持有的 token 验证登录态
     * @returns true 表示登录态有效；false 表示未登录或 token 失效
     */
    const fetchStatus = async (): Promise<boolean> => {
      try {
        const res = await window.api.qobuz.fetchStatus();
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
     * 拉取用户红心歌曲 / 歌单列表
     *
     * Qobuz 的 favorite/playlist API 字段名在不同版本差异较大，当前仅占位，保留旧值
     */
    const fetchUserContent = async (): Promise<void> => {
      if (!isLoggedIn.value) return;
      lastRefreshAt.value = Date.now();
    };

    /** 退出登录：清主进程 token + 清本地 profile */
    const logout = async (): Promise<void> => {
      await window.api.qobuz.clearToken();
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
