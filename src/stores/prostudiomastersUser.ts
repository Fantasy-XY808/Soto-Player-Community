import type { PsmProfile } from "@shared/types/prostudiomasters";

/**
 * ProStudioMasters 账户 store
 *
 * 与 qobuz 之不同：
 * - 鉴权用 session token（safeStorage 加密），不是 user_auth_token
 * - profile 不含订阅等级（PSM 无公开 profile API，仅校验 token 存在性）
 * - 真实 token 有效性在 song_url 调用 API 时按需校验（401/403 视为失效）
 * - 试听 2 分钟 MP3 免登录；完整 Hi-Res 流需用户配置 session token 后访问
 *
 * 注：profile 持久化到 localStorage，启动时直接展示，再异步 fetchStatus 刷新
 */
export const usePsmUserStore = defineStore(
  "prostudiomastersUser",
  () => {
    /** 用户资料；null 表示未登录 */
    const profile = shallowRef<PsmProfile | null>(null);
    /** fetchStatus 失败标志，用于 UI 提示 token 可能已失效 */
    const statusError = ref<string | null>(null);
    /** 是否已登录 */
    const isLoggedIn = computed(() => profile.value !== null);

    /**
     * 用主进程持有的 token 验证登录态
     *
     * PSM 无公开 profile API，fetchStatus 仅校验 token 存在性；
     * 真实有效性在 song_url 调用 API 时按需校验。
     *
     * @returns true 表示登录态有效；false 表示未登录或 token 失效
     */
    const fetchStatus = async (): Promise<boolean> => {
      try {
        const res = await window.api.prostudiomasters.fetchStatus();
        if (res.ok) {
          profile.value = {
            nickname: res.nickname ?? "prostudiomasters 用户",
          };
          statusError.value = null;
          return true;
        }
        profile.value = null;
        statusError.value = res.error ?? "token invalid";
        return false;
      } catch (err) {
        profile.value = null;
        statusError.value = err instanceof Error ? err.message : String(err);
        return false;
      }
    };

    /** 退出登录：清主进程 token + 清本地 profile */
    const logout = async (): Promise<void> => {
      await window.api.prostudiomasters.clearToken();
      profile.value = null;
      statusError.value = null;
    };

    return {
      profile,
      statusError,
      isLoggedIn,
      fetchStatus,
      logout,
    };
  },
  {
    persist: {
      storage: localStorage,
      pick: ["profile"],
    },
  },
);
