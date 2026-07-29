/**
 * Qobuz API 渲染端
 *
 * 用 Proxy 代理所有接口到主进程：`qobuz.search({keywords})` 等于
 * `window.api.apis.call("qobuz", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回 data；失败 → 抛 Error。
 *
 * 与 kugou 之不同：
 * - 鉴权用 user_auth_token（safeStorage 加密），不是 cookie
 * - 拉流走 song_url 模块的双阶段：登录态 → getFileUrl 签名，未登录 → 30s preview
 */

import type { ApiCallResponse } from "@shared/types/apis";

/**
 * 调用 Qobuz API，返回业务数据
 * @param name 接口名（search / song_url / lyric）
 * @param params 接口参数
 */
export const qobuzCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.apis.call("qobuz", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

type QobuzProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`qobuz.search(...)` / `qobuz.song_url(...)` / `qobuz.lyric(...)` */
export const qobuz: QobuzProxy = new Proxy({} as QobuzProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      qobuzCall<T>(name, params),
});
