/**
 * 订阅 / 取消订阅电台
 *
 * params:
 * - rid  电台 id
 * - t    1 订阅 / 0 取消订阅
 *
 * 响应：`{ code, ... }`（code === 200 表示成功）
 *
 * 注意：该接口需要登录态
 *
 * 端点对齐 NeteaseCloudMusicApi dj_sub：
 *   - 订阅：`/api/djradio/sub`
 *   - 取消订阅：`/api/djradio/unsub`
 *   body 字段为 `id`
 */
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djSub: NeteaseModule = (query, request) => {
  const action = Number(query.t) === 1 ? "sub" : "unsub";
  const data = { id: query.rid };
  return request(`/api/djradio/${action}`, data, createOption(query, "weapi"));
};

export default djSub;
