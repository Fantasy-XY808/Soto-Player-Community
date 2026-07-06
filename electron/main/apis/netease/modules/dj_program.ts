/**
 * 电台节目列表
 *
 * params:
 * - rid     电台 id
 * - offset  偏移量，默认 0
 * - limit   每页数量，默认 30
 * - asc     是否按升序排列（false=最新在前），默认 false
 *
 * 响应：`{ code, count, programs: [{ id, name, coverUrl, duration, createTime, listenerCount, mainSong: { id, ... } }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djProgram: NeteaseModule = (query, request) => {
  const data = {
    rid: query.rid,
    offset: query.offset ?? 0,
    limit: query.limit ?? 30,
    asc: query.asc ?? false,
  };
  return request("/api/dj/program", data, createOption(query, "weapi"));
};

export default djProgram;
