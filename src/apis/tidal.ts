/**
 * Tidal API 渲染端
 *
 * 用 Proxy 代理所有接口到主进程：`tidal.search({keywords})` 等于
 * `window.api.apis.call("tidal", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回 data；失败 → 抛 Error。
 *
 * 与 Qobuz 之不同：
 * - 鉴权用 OAuth 2.0 + PKCE（access_token + refresh_token），不是 user_auth_token
 * - 拉流走 song_url 模块：playbackinfopostpaywall → 解码 manifest → CDN 直链
 * - access_token 1 小时过期，主进程自动刷新（剩余 < 5 分钟时触发）
 */

import type { ApiCallResponse } from "@shared/types/apis";

/**
 * 调用 Tidal API，返回业务数据
 * @param name 接口名（search / song_url / lyric）
 * @param params 接口参数
 */
export const tidalCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.apis.call("tidal", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

type TidalProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`tidal.search(...)` / `tidal.song_url(...)` / `tidal.lyric(...)` */
export const tidal: TidalProxy = new Proxy({} as TidalProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      tidalCall<T>(name, params),
});
