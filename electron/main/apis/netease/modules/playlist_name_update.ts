/**
 * 更新歌单名
 *
 * params:
 * - id    歌单 id
 * - name  新名字
 *
 * 响应：`{ code }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const playlistNameUpdate: NeteaseModule = (query, request) => {
  const data = { id: query.id, name: query.name };
  return request("/api/playlist/update/name", data, createOption(query, "eapi"));
};

export default playlistNameUpdate;
