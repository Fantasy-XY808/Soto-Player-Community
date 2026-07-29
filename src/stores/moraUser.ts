import type { MoraProfile } from "@shared/types/mora";

/**
 * mora 账户 store
 *
 * 与 qobuz 之不同：
 * - 凭证是 cookie 字符串（safeStorage 加密），不是 user_auth_token
 * - profile 仅含 nickname（mora 无 profile API，fetchStatus 仅校验 cookie 存在性）
 * - 试听免登录，付费登录仅用于访问购买曲目元数据；完整流 D 级不接入
 *
 * 注：profile 持久化到 localStorage，启动时直接展示，再异步 fetchStatus 刷新
 */
export const useMoraUserStore = defineStore(
  "moraUser",
  () => {
    /** 用户资料；null 表示未登录 */
    const profile = shallowRef<MoraProfile | null>(null);
    /** 是否已登录 */
    const isLoggedIn = computed(() => profile.value !== null);
    /** fetchStatus 失败原因；null 表示无错误 */
    const statusError = ref<string | null>(null);

    /**
     * 用主进程持有的 cookie 校验登录态
     *
     * mora 无 profile API，fetchStatus 仅校验 cookie 文件存在性 + 解密成功；
     * 成功后用录入时的 nickname（默认 "mora 用户"）填充 profile
     *
     * @returns true 表示登录态有效；false 表示未登录或 cookie 失效
     */
    const fetchStatus = async (): Promise<boolean> => {
      try {
        const res = await window.api.mora.fetchStatus();
        if (res.ok) {
          profile.value = { nickname: res.nickname ?? "mora 用户" };
          statusError.value = null;
          return true;
        }
        profile.value = null;
        statusError.value = res.error ?? "fetch failed";
        return false;
      } catch (err) {
        statusError.value = err instanceof Error ? err.message : String(err);
        return profile.value !== null;
      }
    };

    /** 退出登录：清主进程 cookie + 清本地 profile */
    const logout = async (): Promise<void> => {
      await window.api.mora.clearToken();
      profile.value = null;
      statusError.value = null;
    };

    return {
      profile,
      isLoggedIn,
      statusError,
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
