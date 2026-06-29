/**
 * 新歌速递
 *
 * params:
 * - areaId 地区 id：0=全部 / 7=华语 / 96=欧美 / 8=日本 / 16=韩国 / 0=其他
 * - limit  返回数量，默认 50
 * - offset 偏移
 *
 * 响应：`{ code, data: [{ id, name, song: {...}, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const topSong: NeteaseModule = (query, request) => {
  const data = {
    areaId: query.areaId ?? 0,
    limit: query.limit ?? 50,
    offset: query.offset ?? 0,
    total: true,
  };
  return request("/api/v1/discovery/new/songs", data, createOption(query, "weapi"));
};

export default topSong;
