/**
 * 音源 API 统一 IPC
 *
 * 注册通道：
 * - apis:call(platform, name, params)        调用对应平台的任意接口
 * - apis:clearSession(platform)              清空某平台登录态
 * - apis:invalidateCache(platform, name)    按接口名清空指定平台内存缓存
 * - apis:openLoginWeb(platform)              打开官方网页登录窗口
 * - apis:setCookie(platform, cookie)        手动写入 cookie 登录
 */

import { ipcMain } from "electron";
import {
  callNetease,
  clearNeteaseCookies,
  invalidateNeteaseCache,
  mergeNeteaseCookies,
} from "@main/apis/netease";
import { cookieToJson } from "@main/apis/netease/core/cookie";
import { callQQMusic } from "@main/apis/qqmusic";
import { callKugou } from "@main/apis/kugou";
import { openNeteaseLoginWindow } from "@main/window/login";
import { coreLog } from "@main/utils/logger";
import type { ApiPlatform } from "@shared/types/apis";

/** 各平台的调用器：统一返回 `{ status?, body?, data? }` 由前端按需取 */
const dispatch = async (
  platform: ApiPlatform,
  name: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  switch (platform) {
    case "netease": {
      const res = await callNetease(name, params);
      return { status: res.status, body: res.body };
    }
    case "qqmusic": {
      const data = await callQQMusic(name, params);
      return { data };
    }
    case "kugou": {
      const data = await callKugou(name, params);
      return { data };
    }
    default:
      throw new Error(`unknown platform: ${platform}`);
  }
};

export const registerApisIpc = (): void => {
  ipcMain.handle(
    "apis:call",
    async (_evt, platform: ApiPlatform, name: string, params?: Record<string, unknown>) => {
      try {
        const result = await dispatch(platform, name, params ?? {});
        return { ok: true, ...result };
      } catch (err) {
        coreLog.warn(`[apis] ${platform}.${name} failed:`, err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("apis:clearSession", (_evt, platform: ApiPlatform) => {
    if (platform === "netease") clearNeteaseCookies();
  });

  // 按接口名清除 netease 内存缓存：发送 / 删除评论后让 comment_music 立即失效
  ipcMain.handle("apis:invalidateCache", (_evt, platform: ApiPlatform, name: string) => {
    if (platform === "netease") invalidateNeteaseCache(name);
  });

  // 打开 NCM 官方网页登录，成功后把 cookies 合并写入 session
  ipcMain.handle("apis:openLoginWeb", async (_evt, platform: ApiPlatform) => {
    if (platform !== "netease") return { ok: false, error: "unsupported platform" };
    try {
      const cookies = await openNeteaseLoginWindow();
      if (!cookies) return { ok: false, error: "canceled" };
      mergeNeteaseCookies(cookies);
      return { ok: true };
    } catch (err) {
      coreLog.warn("[apis] openLoginWeb failed:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 手动写入 cookie 登录
  ipcMain.handle("apis:setCookie", (_evt, platform: ApiPlatform, raw: string) => {
    if (platform !== "netease") return { ok: false, error: "unsupported platform" };
    const parsed = cookieToJson(raw);
    if (!parsed.MUSIC_U) return { ok: false, error: "missing MUSIC_U" };
    mergeNeteaseCookies(parsed);
    return { ok: true };
  });
};
