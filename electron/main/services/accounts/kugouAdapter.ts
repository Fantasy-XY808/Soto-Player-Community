/**
 * 酷狗 PlatformLoginAdapter 实现
 *
 * 酷狗登录参考 KuGouMusicApi-main/module/login.js（账号密码登录）：
 *   1. 用 AES 加密 { pwd, code, clienttime_ms }，得到 str + key
 *   2. 用 RSA 加密 { clienttime_ms, key }，得到 pk
 *   3. POST /v9/login_by_pwd，data 含 t1/t2/t3（伪装字段）+ username + params + pk
 *   4. 服务端返回 secu_params，用 step 1 的 key 做 AES 解密，得到 token / userid / vip_type 等
 *   5. 把 userid / token / vip_type / vip_token 拼成 cookie 字符串存入 kugou.json
 *
 * TODO（加密实现待补全）：
 *   - 需要 node-forge 做 raw RSA 加密（KuGouMusicApi 用裸 modPow，Node crypto 不直接支持）
 *   - 替代方案：用 BigInteger 库手写 modPow，或参考 KuGouMusicApi/util/crypto.js 移植
 *   - 当前 accountLogin 直接抛 NotImplementedError，UI 会显示「酷狗登录加密待接入」
 *
 * 已实现：
 *   - fetchLoginStatus：复用 verifyKugouCookie，走 y.kugou.com/v1/get_userinfo
 *   - logout：clearKugouCookieSync 清除本地凭证
 *   - refreshLogin：酷狗无独立 refresh 接口，token 失效需重新登录
 */

import type {
  PlatformLoginAdapter,
  PlatformUserProfile,
} from "@shared/types/account";
import {
  clearKugouCookieSync,
  getKugouCookieSync,
  verifyKugouCookie,
} from "@main/ipc/kugou";
import { getKugouCredentials } from "@main/apis/kugou/core/cookie";
import { kugouLog } from "@main/utils/logger";

/** 酷狗账号密码登录适配器 */
export const kugouLoginAdapter: PlatformLoginAdapter = {
  platform: "kugou",
  capabilities: {
    qr: false,
    accountPassword: true,
    phone: false,
  },

  /**
   * 账号密码登录
   *
   * TODO: 实现加密流程（参考 KuGouMusicApi-main/module/login.js + util/crypto.js）
   * 当前未实现，抛错让 UI 显示「酷狗登录加密待接入」
   */
  accountLogin: async (_username, _password) => {
    throw new Error(
      "kugou account login not implemented: requires AES + RSA crypto (see TODO in kugouAdapter.ts)",
    );
  },

  /**
   * 校验当前会话：读 kugou.json 中的 cookie，调用 y.kugou.com/v1/get_userinfo
   * @returns 已登录返回 profile；未登录或会话失效返回 null
   */
  fetchLoginStatus: async (): Promise<PlatformUserProfile | null> => {
    const cookie = getKugouCookieSync();
    if (!cookie) return null;
    const result = await verifyKugouCookie(cookie);
    if (!result.ok || !result.profile) return null;
    const creds = getKugouCredentials();
    return {
      userId: creds.userid || "0",
      nickname: result.profile.nickname,
      isVip: result.profile.vipType > 0,
      vipType: result.profile.vipType > 0 ? "酷狗 VIP" : undefined,
      platformExtra: {
        vipType: result.profile.vipType,
      },
    };
  },

  /** 酷狗无独立 refresh 接口，token 失效需重新登录 */
  refreshLogin: async () => {
    kugouLog.warn("[kugou] refreshLogin: 酷狗无独立续期接口，请重新登录");
  },

  /** 登出：清除本地凭证 */
  logout: async () => {
    clearKugouCookieSync();
  },
};

/** 当前酷狗是否已登录（cookie 存在且 userid + token 都有） */
export const isKugouLoggedIn = (): boolean => {
  const cookie = getKugouCookieSync();
  if (!cookie) return false;
  const creds = getKugouCredentials();
  return !!creds.userid && !!creds.token;
};
