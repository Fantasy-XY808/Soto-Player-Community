/**
 * Internet Archive API 渲染端
 *
 * 用 Proxy 代理所有接口到主进程：`archive.search({keywords})` 等于
 * `window.api.apis.call("archive", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回 data；失败 → 抛 Error。
 *
 * 与 Qobuz 之不同：
 * - 完全无鉴权：不需要 token / cookie / signature
 * - archive.org 公开 API，仅通过统一 apis:call 通道访问，不暴露独立 window.api.archive
 */

import type { ApiCallResponse } from "@shared/types/apis";

/**
 * 调用 Archive API，返回业务数据
 * @param name 接口名（search / song_url / lyric）
 * @param params 接口参数
 */
export const archiveCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.apis.call("archive", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

type ArchiveProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`archive.search(...)` / `archive.song_url(...)` / `archive.lyric(...)` */
export const archive: ArchiveProxy = new Proxy({} as ArchiveProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      archiveCall<T>(name, params),
});
