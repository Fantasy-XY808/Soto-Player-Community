/**
 * 订阅 / 取消订阅歌单
 *
 * params:
 * - id  歌单 id
 * - t   1 订阅 / 2 取消，默认 1
 *
 * 响应：`{ code }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const playlistSubscribe: NeteaseModule = (query, request) => {
  const action = query.t === 2 ? "unsubscribe" : "subscribe";
  const data = { id: query.id };
  return request(`/api/playlist/${action}`, data, createOption(query, "eapi"));
};

export default playlistSubscribe;
