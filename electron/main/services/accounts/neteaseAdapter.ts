/**
 * 网易云 PlatformLoginAdapter 实现
 *
 * 把现有 callNetease / cookie 管理 / login_qr 系列接口包装成统一的
 * PlatformLoginAdapter，让 user store 等业务层通过 registry 调用，
 * 而非直接 import 网易云具体 API。
 */

import type {
  PlatformLoginAdapter,
  PlatformUserProfile,
  QrCheckResult,
  QrStatusCode,
} from "@shared/types/account";
import { callNetease } from "@main/apis/netease";
import { clearNeteaseCookies, getNeteaseCookies } from "@main/apis/netease";
import { cookieToJson } from "@main/apis/netease/core/cookie";

/**
 * 校验 cookie 并取当前用户 profile
 *
 * 复用 login_status 接口：返回数据结构同 fetchLoginStatus（src/apis/login/netease.ts）
 */
const fetchStatus = async (): Promise<PlatformUserProfile | null> => {
  const body = await callNetease("login_status", {});
  const raw = body?.body?.data?.profile as
    | (Partial<{
        userId: number;
        nickname: string;
        avatarUrl: string;
        backgroundUrl: string;
        signature: string;
        vipType: number;
        gender: number;
        province: number;
        city: number;
      }> & { userId?: number })
    | undefined;
  if (!raw?.userId) return null;
  return {
    userId: String(raw.userId),
    nickname: raw.nickname ?? "",
    avatarUrl: raw.avatarUrl,
    signature: raw.signature,
    isVip: typeof raw.vipType === "number" && raw.vipType > 0,
    vipType: raw.vipType ? `黑胶 VIP` : undefined,
    platformExtra: {
      vipType: raw.vipType,
      gender: raw.gender,
      province: raw.province,
      city: raw.city,
      backgroundUrl: raw.backgroundUrl,
    },
  };
};

/** 网易云扫码登录适配器 */
export const neteaseLoginAdapter: PlatformLoginAdapter = {
  platform: "netease",
  capabilities: {
    qr: true,
    accountPassword: false,
    phone: true,
  },

  startQrLogin: async () => {
    const body = await callNetease("login_qr_key", { timestamp: Date.now() });
    const unikey = body?.body?.data?.unikey as string | undefined;
    if (!unikey) throw new Error("qr key missing");
    return {
      key: unikey,
      qrContent: `https://music.163.com/login?codekey=${unikey}`,
    };
  },

  pollQrStatus: async (key: string): Promise<QrCheckResult> => {
    const body = await callNetease("login_qr_check", {
      key,
      timestamp: Date.now(),
    });
    const code = (body?.body?.code ?? 801) as QrStatusCode;
    return {
      code,
      // 803 时 cookie 已由主进程 SESSION_MUTATING 自动落库；这里返回 cookie 串用于 UI 判定
      cookie: body?.body?.cookie,
      nickname: body?.body?.nickname,
      avatarUrl: body?.body?.avatarUrl,
    };
  },

  /** 发送短信验证码：调用网易云 captcha_sent 接口
   *  返回的 code=200 表示发送成功；其他 code 由调用方翻译为 UI 文案 */
  sendSms: async (phone: string, ctcode = "86"): Promise<void> => {
    if (!phone) throw new Error("phone is required");
    const body = await callNetease("captcha_sent", { phone, ctcode });
    const code = body?.body?.code;
    if (code !== 200) {
      const msg = body?.body?.message || `captcha_sent code=${code ?? "unknown"}`;
      throw new Error(msg);
    }
  },

  /** 手机号 + 短信验证码登录：调用网易云 login_cellphone 接口
   *  成功后 cookie 由主进程 SESSION_MUTATING 自动落库（含 MUSIC_U），
   *  这里直接拉 profile 返回给 UI */
  phoneLogin: async (
    phone: string,
    captcha: string,
    ctcode = "86",
  ): Promise<PlatformUserProfile> => {
    if (!phone) throw new Error("phone is required");
    if (!captcha) throw new Error("captcha is required");
    const body = await callNetease("login_cellphone", {
      phone,
      captcha,
      countrycode: ctcode,
    });
    const result = body?.body as { code?: number; profile?: { userId?: number } } | undefined;
    if (result?.code !== 200 || !result.profile?.userId) {
      const msg = (body?.body as { message?: string } | undefined)?.message
        || `login_cellphone code=${result?.code ?? "unknown"}`;
      throw new Error(msg);
    }
    // 登录成功后 cookie 已落库，复用 fetchStatus 拉规范化的 PlatformUserProfile
    const profile = await fetchStatus();
    if (!profile) throw new Error("phone login succeeded but profile is empty");
    return profile;
  },

  fetchLoginStatus: fetchStatus,

  refreshLogin: async () => {
    await callNetease("login_refresh", {});
  },

  logout: async () => {
    try {
      await callNetease("logout", {});
    } catch {
      // 服务端登出失败不阻塞本地清理
    }
    clearNeteaseCookies();
  },
};

/** 当前网易云是否已登录（cookie 中包含 MUSIC_U） */
export const isNeteaseLoggedIn = (): boolean => {
  const cookies = getNeteaseCookies();
  return !!cookies.MUSIC_U;
};

/** 解析 cookie 字符串为对象（其他平台后续可复用） */
export const parseCookieString = (cookie: string): Record<string, string> =>
  cookieToJson(cookie);
