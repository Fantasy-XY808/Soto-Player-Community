/**
 * 相似歌曲
 *
 * params:
 * - songid  歌曲 id
 * - limit   返回数量，默认 50
 * - offset  偏移
 *
 * 响应：`{ code, songs: NeteaseSong[], more, asd }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const simiSong: NeteaseModule = (query, request) => {
  const data = {
    songid: query.songid,
    limit: query.limit ?? 50,
    offset: query.offset ?? 0,
  };
  return request("/api/v1/discovery/simiSong", data, createOption(query, "weapi"));
};

export default simiSong;
