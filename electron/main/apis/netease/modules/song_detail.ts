/**
 * 获取歌曲详情
 *
 * params:
 * - ids   歌曲 id（单个或逗号分隔）
 *
 * 响应：`{ code, songs: [{ id, name, ar, al, dt, ... }], privileges: [...] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const song_detail: NeteaseModule = (query, request) => {
  const ids = String(query.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const data = {
    c: `[${ids.map((id) => `{"id":${id}}`).join(",")}]`,
  };
  return request("/api/v3/song/detail", data, createOption(query));
};

export default song_detail;
