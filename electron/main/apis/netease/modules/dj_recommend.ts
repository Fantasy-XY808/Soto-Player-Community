/**
 * 电台推荐
 *
 * params:
 * - limit  返回数量，默认 30
 *
 * 响应：`{ code, djRadios: [{ id, name, dj, picUrl, desc, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djRecommend: NeteaseModule = (query, request) => {
  const data = { limit: query.limit ?? 30 };
  return request("/api/dj/recommend", data, createOption(query, "weapi"));
};

export default djRecommend;
