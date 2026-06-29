/**
 * MV 首页（最新 MV）
 *
 * params:
 * - limit  返回数量，默认 30
 * - area   地区：内地 / 港台 / 欧美 / 日本 / 韩国等，空字符串表示全部
 *
 * 响应：`{ code, data: [{ id, name, artistName, artists, cover, duration, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const mvFirst: NeteaseModule = (query, request) => {
  const data = {
    limit: query.limit ?? 30,
    area: query.area ?? "",
    total: true,
  };
  return request("/api/mv/first", data, createOption(query, "weapi"));
};

export default mvFirst;
