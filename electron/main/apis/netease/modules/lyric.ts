/**
 * 歌词（旧版）
 * params:
 * - id  歌曲 id
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const lyric: NeteaseModule = (query, request) => {
  const data = {
    id: query.id,
    tv: -1,
    lv: -1,
    rv: -1,
    kv: -1,
    _nmclfl: 1,
  };
  return request("/api/song/lyric", data, createOption(query));
};

export default lyric;
