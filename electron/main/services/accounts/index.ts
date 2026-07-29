/**
 * 多平台账号服务入口
 *
 * 启动时注册所有已实现账号体系的平台适配器；
 * 业务层通过 accounts/registry 调用，不直接 import 具体平台实现。
 */

import type { AccountPlatform } from "@shared/types/account";
import {
  getLoginAdapter,
  isLoginSupported,
  listSupportedPlatforms,
  registerLoginAdapter,
} from "./registry";
import { isNeteaseLoggedIn, neteaseLoginAdapter } from "./neteaseAdapter";
import { isKugouLoggedIn, kugouLoginAdapter } from "./kugouAdapter";

/** 注册所有已实现的平台登录适配器 */
export const initAccountAdapters = (): void => {
  registerLoginAdapter(neteaseLoginAdapter);
  registerLoginAdapter(kugouLoginAdapter);
};

/**
 * 检查指定平台是否已登录
 *
 * 各平台登录态判定逻辑不同（网易云看 MUSIC_U，酷狗看 userid + token），
 * 优先用 cookie 快速判定；若需精确判定则调用 adapter.fetchLoginStatus
 */
export const isPlatformLoggedIn = (platform: AccountPlatform): boolean => {
  if (!isLoginSupported(platform)) return false;
  if (platform === "netease") return isNeteaseLoggedIn();
  if (platform === "kugou") return isKugouLoggedIn();
  // TODO(qqmusic): adapter 实现后在此补充 isQqmusicLoggedIn 判定
  return false;
};

/** 登出指定平台 */
export const logoutPlatform = async (platform: AccountPlatform): Promise<void> => {
  const adapter = getLoginAdapter(platform);
  if (!adapter) return;
  await adapter.logout();
};

export {
  getLoginAdapter,
  listSupportedPlatforms,
  isLoginSupported,
  registerLoginAdapter,
};
