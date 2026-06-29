/**
 * 推荐歌单（无需登录）
 *
 * 响应：`{ code, result: NeteasePlaylist[] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const personalized: NeteaseModule = (query, request) => {
  const data = { limit: query.limit ?? 30, total: true, n: 1000 };
  return request("/api/personalized/playlist", data, createOption(query, "weapi"));
};

export default personalized;
