/**
 * 多平台账号 IPC
 *
 * 暴露 window.api.accounts 给渲染端：
 *   - listSupportedPlatforms: 列出已接入账号体系的平台
 *   - getLoginAdapter: 获取某平台的扫码登录适配器
 *   - isLoggedIn: 当前某平台是否已登录
 *   - logout: 登出指定平台
 *
 * 适配器方法通过 IPC 转发到主进程实现，渲染端不直接 import 主进程模块
 */

import { ipcMain } from "electron";
import type {
  AccountPlatform,
  PlatformLoginAdapter,
  PlatformUserProfile,
  QrCheckResult,
} from "@shared/types/account";
import {
  getLoginAdapter,
  isPlatformLoggedIn,
  listSupportedPlatforms,
  logoutPlatform,
} from "@main/services/accounts";
import { coreLog } from "@main/utils/logger";

/**
 * 把适配器方法序列化为可 IPC 调用的形式
 *
 * 渲染端调用约定：
 *   window.api.accounts.startQrLogin(platform) → { key, qrContent }
 *   window.api.accounts.pollQrStatus(platform, key) → QrCheckResult
 *   window.api.accounts.fetchLoginStatus(platform) → PlatformUserProfile | null
 *   window.api.accounts.refreshLogin(platform) → void
 *   window.api.accounts.logout(platform) → void
 */
const getAdapterOrThrow = (platform: AccountPlatform): PlatformLoginAdapter => {
  const adapter = getLoginAdapter(platform);
  if (!adapter) {
    throw new Error(`platform ${platform} does not support account login`);
  }
  return adapter;
};

export const registerAccountsIpc = (): void => {
  ipcMain.handle("accounts:listSupportedPlatforms", (): AccountPlatform[] =>
    listSupportedPlatforms(),
  );

  ipcMain.handle(
    "accounts:getCapabilities",
    (
      _e,
      platform: AccountPlatform,
    ): { qr: boolean; accountPassword: boolean; phone: boolean } | undefined => {
      const adapter = getLoginAdapter(platform);
      return adapter ? adapter.capabilities : undefined;
    },
  );

  ipcMain.handle(
    "accounts:isLoggedIn",
    (_e, platform: AccountPlatform): boolean => isPlatformLoggedIn(platform),
  );

  ipcMain.handle(
    "accounts:startQrLogin",
    async (
      _e,
      platform: AccountPlatform,
    ): Promise<{ key: string; qrContent: string }> => {
      const adapter = getAdapterOrThrow(platform);
      if (!adapter.startQrLogin) {
        throw new Error(`platform ${platform} does not support qr login`);
      }
      return adapter.startQrLogin();
    },
  );

  ipcMain.handle(
    "accounts:pollQrStatus",
    async (_e, platform: AccountPlatform, key: string): Promise<QrCheckResult> => {
      const adapter = getAdapterOrThrow(platform);
      if (!adapter.pollQrStatus) {
        throw new Error(`platform ${platform} does not support qr login`);
      }
      return adapter.pollQrStatus(key);
    },
  );

  ipcMain.handle(
    "accounts:accountLogin",
    async (
      _e,
      platform: AccountPlatform,
      username: string,
      password: string,
    ): Promise<PlatformUserProfile> => {
      const adapter = getAdapterOrThrow(platform);
      if (!adapter.accountLogin) {
        throw new Error(`platform ${platform} does not support account login`);
      }
      return adapter.accountLogin(username, password);
    },
  );

  ipcMain.handle(
    "accounts:sendSms",
    async (
      _e,
      platform: AccountPlatform,
      phone: string,
      ctcode?: string,
    ): Promise<void> => {
      const adapter = getAdapterOrThrow(platform);
      if (!adapter.sendSms) {
        throw new Error(`platform ${platform} does not support phone login`);
      }
      await adapter.sendSms(phone, ctcode);
    },
  );

  ipcMain.handle(
    "accounts:phoneLogin",
    async (
      _e,
      platform: AccountPlatform,
      phone: string,
      captcha: string,
      ctcode?: string,
    ): Promise<PlatformUserProfile> => {
      const adapter = getAdapterOrThrow(platform);
      if (!adapter.phoneLogin) {
        throw new Error(`platform ${platform} does not support phone login`);
      }
      return adapter.phoneLogin(phone, captcha, ctcode);
    },
  );

  ipcMain.handle(
    "accounts:fetchLoginStatus",
    async (
      _e,
      platform: AccountPlatform,
    ): Promise<PlatformUserProfile | null> => {
      const adapter = getAdapterOrThrow(platform);
      try {
        return await adapter.fetchLoginStatus();
      } catch (err) {
        coreLog.warn(`[accounts] fetchLoginStatus ${platform} failed:`, err);
        return null;
      }
    },
  );

  ipcMain.handle(
    "accounts:refreshLogin",
    async (_e, platform: AccountPlatform): Promise<void> => {
      const adapter = getAdapterOrThrow(platform);
      await adapter.refreshLogin();
    },
  );

  ipcMain.handle(
    "accounts:logout",
    async (_e, platform: AccountPlatform): Promise<void> => {
      await logoutPlatform(platform);
    },
  );
};
