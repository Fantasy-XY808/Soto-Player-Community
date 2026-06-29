/**
 * MV 播放地址
 *
 * params:
 * - id  MV id
 * - r   分辨率，默认 1080
 *
 * 响应：`{ code, data: { id, url, size, code, expi, ... } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const mvUrl: NeteaseModule = (query, request) => {
  const data = {
    id: query.id,
    r: query.r ?? 1080,
  };
  return request("/api/song/enhance/player/mv-url", data, createOption(query, "weapi"));
};

export default mvUrl;
