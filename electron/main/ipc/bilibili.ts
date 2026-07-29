/**
 * Bilibili 账户 IPC
 *
 * 与 QQ 音乐 / 酷狗 风格一致：
 * - 凭证文件：{configDir}/bilibili.json，整串 cookie 经 safeStorage 加密
 * - setCookie / getCookie / clearCookie：基础凭证管理
 * - openLoginWeb：打开 Bilibili 网页登录窗口，登录成功后直接落盘 cookie
 * - fetchStatus：用 cookie 调 /x/web-interface/nav 验证登录态，返回用户资料
 * - persistBilibiliCookie：抽离的写盘函数，供 apis:openLoginWeb 直接调用
 *
 * 关键 cookie：SESSDATA（登录态）+ bili_jct（CSRF）+ DedeUserID（用户 uid）
 */

import { ipcMain } from "electron";
import { bilibiliLog } from "@main/utils/logger";
import {
  getBilibiliCookieSync,
  persistBilibiliCookieInternal,
  clearBilibiliCookieInternal,
} from "@main/apis/bilibili/core/credentials";
import { BILI_UA } from "@main/apis/bilibili/core/config";

/** 从 cookie 字符串中提取 DedeUserID */
const extractUserId = (cookie: string): string | null => {
  const match = /DedeUserID\s*=\s*(\d+)/i.exec(cookie);
  return match ? match[1] : null;
};

interface BiliNavResp {
  code?: number;
  data?: {
    isLogin?: boolean;
    mid?: number;
    uname?: string;
    vipStatus?: number;
    vipType?: number;
  };
}

/**
 * 用 cookie 调 /x/web-interface/nav 验证登录态并返回用户资料
 *
 * code === 0 && data.isLogin === true 视为登录成功
 */
const verifyCookie = async (
  cookie: string,
): Promise<{ ok: boolean; profile?: { nickname: string; vipType: number }; error?: string }> => {
  try {
    const res = await fetch("https://api.bilibili.com/x/web-interface/nav", {
      method: "GET",
      headers: {
        "User-Agent": BILI_UA,
        Referer: "https://www.bilibili.com/",
        Cookie: cookie,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 200) {
      return { ok: false, error: `Bilibili HTTP ${res.status}` };
    }
    const data = (await res.json()) as BiliNavResp;
    if (data.code !== 0 || !data.data?.isLogin) {
      return { ok: false, error: "not logged in" };
    }
    const uid = extractUserId(cookie) ?? (data.data.mid ? String(data.data.mid) : "");
    return {
      ok: true,
      profile: {
        nickname: data.data.uname ?? (uid ? `B站用户${uid.slice(-4)}` : "B站用户"),
        vipType: data.data.vipType ?? 0,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * 持久化 Bilibili cookie 到加密凭证文件
 *
 * 抽离自 bilibili:setCookie IPC handler，供 apis:openLoginWeb 在登录窗口
 * 拿到 cookie 后直接调用，避免通过 ipcMain.emit 绕路。
 *
 * @param cookie 完整 cookie 字符串（含 SESSDATA / bili_jct / DedeUserID 等）
 * @returns 写入成功返回 true；空字符串 / 异常返回 false
 */
export const persistBilibiliCookie = (cookie: string): boolean =>
  persistBilibiliCookieInternal(cookie);

export const registerBilibiliIpc = (): void => {
  ipcMain.handle(
    "bilibili:setCookie",
    (_e, cookie: string): { ok: true } | { ok: false; error: string } => {
      const ok = persistBilibiliCookie(cookie);
      return ok ? { ok: true } : { ok: false, error: "empty cookie or write failed" };
    },
  );

  ipcMain.handle("bilibili:getCookie", (): string | null => getBilibiliCookieSync());

  ipcMain.handle("bilibili:clearCookie", (): { ok: true } | { ok: false; error: string } => {
    const ok = clearBilibiliCookieInternal();
    return ok ? { ok: true } : { ok: false, error: "delete failed" };
  });

  // 打开 Bilibili 网页登录窗口，登录成功后直接落盘 cookie
  // 与 apis:openLoginWeb(platform="bilibili") 行为一致；本通道作为冗余入口
  ipcMain.handle(
    "bilibili:openLoginWeb",
    async (): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const { openBilibiliLoginWindow } = await import("@main/window/bilibiliLogin");
        const cookies = await openBilibiliLoginWindow();
        if (!cookies) return { ok: false, error: "canceled" };
        const ok = persistBilibiliCookie(cookies);
        return ok ? { ok: true } : { ok: false, error: "persist failed" };
      } catch (err) {
        bilibiliLog.error("bilibili:openLoginWeb failed:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    "bilibili:fetchStatus",
    async (): Promise<{
      ok: boolean;
      profile?: { nickname: string; vipType: number };
      error?: string;
    }> => {
      const cookie = getBilibiliCookieSync();
      if (!cookie) return { ok: false, error: "no cookie" };
      return verifyCookie(cookie);
    },
  );
};
