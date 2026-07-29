/**
 * Bilibili API 渲染端
 *
 * 用 Proxy 代理所有接口到主进程：`bilibili.search({keywords})` 等于
 * `window.api.apis.call("bilibili", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回 data；失败 → 抛 Error。
 *
 * 与 archive 之不同：
 * - 搜索需要 buvid3 cookie（在主进程 core/request.ts 统一注入匿名占位值）
 * - 取流走 DASH 音频流（fnval=16），按 id 优先级选最优音频
 * - 默认非真母带：UI 需标注（在 search/bilibili.ts 的 songToTrack 设置 comment）
 */

import type { ApiCallResponse } from "@shared/types/apis";

/**
 * 调用 Bilibili API，返回业务数据
 * @param name 接口名（search / song_url / lyric）
 * @param params 接口参数
 */
export const bilibiliCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.apis.call("bilibili", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

type BilibiliProxy = Record<
  string,
  <T = unknown>(params?: Record<string, unknown>) => Promise<T>
>;

/** 任意方法调用：`bilibili.search(...)` / `bilibili.song_url(...)` / `bilibili.lyric(...)` */
export const bilibili: BilibiliProxy = new Proxy({} as BilibiliProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      bilibiliCall<T>(name, params),
});
