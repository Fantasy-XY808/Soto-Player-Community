/**
 * 删除歌单
 *
 * params:
 * - id  歌单 id（单个）
 * 响应：`{ code }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const playlistDelete: NeteaseModule = (query, request) => {
  const data = { ids: `[${query.id}]` };
  return request("/api/playlist/remove", data, createOption(query, "weapi"));
};

export default playlistDelete;
