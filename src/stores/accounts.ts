/**
 * 多平台账号 store
 *
 * 管理各平台的登录态、用户资料，与现有 user store（网易云专用）解耦：
 *   - accounts store 只管「登录态 / profile / 通用操作」（如调用 IPC 启动扫码）
 *   - user store 继续管网易云特有的歌单/专辑/歌手等用户数据
 *
 * 后续接入酷狗 / QQ 等平台时：
 *   1. 在主进程 services/accounts/<platform>Adapter.ts 实现 PlatformLoginAdapter
 *   2. 在 services/accounts/index.ts 注册到 registry
 *   3. 在 AccountPlatform 类型中扩展平台 key
 *   4. 该 store 自动支持新平台的登录/登出/状态查询，无需改动业务层
 *
 * 数据隔离：每个平台的 profile / 登录态独立存储，互不影响。
 * 用户数据隔离（歌单/专辑等）由各平台专用 store 或 user store 内部按平台区分实现。
 */

import { defineStore } from "pinia";
import { shallowRef } from "vue";
import type {
  AccountPlatform,
  PlatformUserProfile,
} from "@shared/types/account";

/** 平台登录态信息（每平台独立） */
interface PlatformAccountState {
  /** 用户资料（未登录为 null） */
  profile: PlatformUserProfile | null;
  /** 是否已拉取过登录态（避免重复 IPC 调用） */
  loaded: boolean;
  /** 登录态刷新中 */
  loading: boolean;
}

const createEmptyState = (): PlatformAccountState => ({
  profile: null,
  loaded: false,
  loading: false,
});

export const useAccountsStore = defineStore("accounts", () => {
  /** 各平台账号状态（按 platform key 隔离） */
  const states = shallowRef<Record<string, PlatformAccountState>>({
    netease: createEmptyState(),
    kugou: createEmptyState(),
    // TODO(qqmusic): adapter 实现后由主进程 registry 自动加入 supportedPlatforms
    qqmusic: createEmptyState(),
  });

  /** 已注册支持登录的平台列表 */
  const supportedPlatforms = shallowRef<AccountPlatform[]>(["netease", "kugou"]);

  /** 获取某平台状态（不存在时返回空状态，不写入 states） */
  const getState = (platform: AccountPlatform): PlatformAccountState =>
    states.value[platform] ?? createEmptyState();

  /** 内部更新某平台状态 */
  const setState = (
    platform: AccountPlatform,
    patch: Partial<PlatformAccountState>,
  ): void => {
    const current = states.value[platform] ?? createEmptyState();
    states.value = {
      ...states.value,
      [platform]: { ...current, ...patch },
    };
  };

  /**
   * 拉取某平台登录态
   * @param platform 平台
   * @param force true 强制刷新（已加载也重拉）
   * @returns 是否已登录
   */
  const fetchStatus = async (
    platform: AccountPlatform,
    force = false,
  ): Promise<boolean> => {
    const state = getState(platform);
    if (!force && state.loaded) return state.profile !== null;
    if (state.loading) return state.profile !== null;
    setState(platform, { loading: true });
    try {
      const profile = await window.api.accounts.fetchLoginStatus(platform);
      setState(platform, {
        profile,
        loaded: true,
        loading: false,
      });
      return profile !== null;
    } catch (err) {
      console.warn(`[accounts] fetchStatus ${platform} failed:`, err);
      setState(platform, { loading: false });
      return false;
    }
  };

  /** 拉取所有支持平台的登录态（应用启动时调用） */
  const fetchAllStatus = async (): Promise<void> => {
    try {
      supportedPlatforms.value = await window.api.accounts.listSupportedPlatforms();
    } catch {
      // 主进程未注册时回退到默认值
      supportedPlatforms.value = ["netease", "kugou"];
    }
    await Promise.all(
      supportedPlatforms.value.map((p) => fetchStatus(p, true).catch(() => false)),
    );
  };

  /**
   * 登出指定平台
   * 调用主进程 logout 后清空本地状态
   */
  const logout = async (platform: AccountPlatform): Promise<void> => {
    await window.api.accounts.logout(platform);
    setState(platform, { profile: null, loaded: true });
  };

  /** 指定平台是否已登录（基于已加载的 profile） */
  const isLoggedIn = (platform: AccountPlatform): boolean => {
    const state = getState(platform);
    return state.profile !== null;
  };

  /** 获取某平台 profile */
  const getProfile = (
    platform: AccountPlatform,
  ): PlatformUserProfile | null => getState(platform).profile;

  /** 当前活跃平台（用于 UI 切换上下文，默认网易云） */
  const activePlatform = shallowRef<AccountPlatform>("netease");
  const setActivePlatform = (platform: AccountPlatform): void => {
    activePlatform.value = platform;
  };

  return {
    states,
    supportedPlatforms,
    activePlatform,
    setState,
    getState,
    getProfile,
    isLoggedIn,
    fetchStatus,
    fetchAllStatus,
    logout,
    setActivePlatform,
  };
});
