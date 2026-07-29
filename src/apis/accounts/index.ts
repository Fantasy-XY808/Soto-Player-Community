/**
 * 多平台账号 API（渲染端封装）
 *
 * 封装 window.api.accounts 调用，提供类型安全的便捷方法。
 * 业务层通过此模块调用，不直接访问 window.api，便于：
 *   - 统一错误处理
 *   - 后续可加缓存 / 日志 / 事件订阅
 *   - 单元测试 mock
 */

import type {
  AccountPlatform,
  PlatformUserProfile,
  QrCheckResult,
} from "@shared/types/account";

/** 列出已接入账号体系的平台 */
export const listSupportedPlatforms = (): Promise<AccountPlatform[]> =>
  window.api.accounts.listSupportedPlatforms();

/** 获取某平台支持的登录方式 */
export const getCapabilities = (
  platform: AccountPlatform,
): Promise<{ qr: boolean; accountPassword: boolean; phone: boolean } | undefined> =>
  window.api.accounts.getCapabilities(platform);

/** 指定平台是否已登录 */
export const isLoggedIn = (platform: AccountPlatform): Promise<boolean> =>
  window.api.accounts.isLoggedIn(platform);

/** 启动扫码登录 */
export const startQrLogin = (
  platform: AccountPlatform,
): Promise<{ key: string; qrContent: string }> =>
  window.api.accounts.startQrLogin(platform);

/** 轮询扫码状态 */
export const pollQrStatus = (
  platform: AccountPlatform,
  key: string,
): Promise<QrCheckResult> => window.api.accounts.pollQrStatus(platform, key);

/** 账号密码登录 */
export const accountLogin = (
  platform: AccountPlatform,
  username: string,
  password: string,
): Promise<PlatformUserProfile> =>
  window.api.accounts.accountLogin(platform, username, password);

/** 发送短信验证码 */
export const sendSms = (
  platform: AccountPlatform,
  phone: string,
  ctcode?: string,
): Promise<void> => window.api.accounts.sendSms(platform, phone, ctcode);

/** 手机号 + 短信验证码登录 */
export const phoneLogin = (
  platform: AccountPlatform,
  phone: string,
  captcha: string,
  ctcode?: string,
): Promise<PlatformUserProfile> =>
  window.api.accounts.phoneLogin(platform, phone, captcha, ctcode);

/** 校验当前会话并取用户资料 */
export const fetchLoginStatus = (
  platform: AccountPlatform,
): Promise<PlatformUserProfile | null> =>
  window.api.accounts.fetchLoginStatus(platform);

/** 续期会话 */
export const refreshLogin = (platform: AccountPlatform): Promise<void> =>
  window.api.accounts.refreshLogin(platform);

/** 登出 */
export const logout = (platform: AccountPlatform): Promise<void> =>
  window.api.accounts.logout(platform);
