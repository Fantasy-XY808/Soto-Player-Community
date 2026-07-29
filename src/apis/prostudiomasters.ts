/**
 * ProStudioMasters API 渲染端
 *
 * 用 Proxy 代理所有接口到主进程：`prostudiomasters.search({keywords})` 等于
 * `window.api.apis.call("prostudiomasters", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回 data；失败 → 抛 Error。
 *
 * 与 mora 之不同：
 * - ProStudioMasters 是付费 Hi-Res 商店，需登录凭据；scaffold 阶段 search/song_url 返回空结果
 * - 仅通过统一 apis:call 通道访问，不暴露独立 window.api.prostudiomasters
 */

import type { ApiCallResponse } from "@shared/types/apis";

/**
 * 调用 ProStudioMasters API，返回业务数据
 * @param name 接口名（search / song_url / lyric）
 * @param params 接口参数
 */
export const prostudiomastersCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.apis.call("prostudiomasters", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

type PsmProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`prostudiomasters.search(...)` / `prostudiomasters.song_url(...)` / `prostudiomasters.lyric(...)` */
export const prostudiomasters: PsmProxy = new Proxy({} as PsmProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      prostudiomastersCall<T>(name, params),
});
