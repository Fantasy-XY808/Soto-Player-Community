/**
 * 歌曲关联的 MV
 *
 * params:
 * - songid  歌曲 id
 *
 * 响应：`{ code, mvid, ... }` —— mvid 为 0 表示该歌曲无关联 MV
 * 仅 mvid > 0 时有效
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const songMvDynamic: NeteaseModule = (query, request) => {
  const data = { songid: query.songid };
  return request("/api/song/mv/dynamic", data, createOption(query, "weapi"));
};

export default songMvDynamic;
