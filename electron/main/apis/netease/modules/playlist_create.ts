/**
 * 新建歌单
 *
 * params:
 * - name     歌单名
 * - privacy  0 公开 / 10 私密，默认 0
 * - type     NORMAL / VIDEO，默认 NORMAL
 *
 * 响应：`{ code, id, playlist: { id, name, ... } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const playlistCreate: NeteaseModule = (query, request) => {
  const data = {
    name: query.name,
    privacy: query.privacy ?? 0,
    type: query.type ?? "NORMAL",
  };
  return request("/api/playlist/create", data, createOption(query, "weapi"));
};

export default playlistCreate;
