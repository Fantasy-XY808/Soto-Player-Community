/**
 * 指定分类下的热门电台
 *
 * params:
 * - cateId  分类 id
 * - limit   返回数量，默认 30
 * - offset  偏移量，默认 0
 *
 * 响应：`{ code, djRadios: [{ id, name, dj, picUrl, category, ... }] }`
 */
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djRadioHot: NeteaseModule = (query, request) => {
  const data = {
    cateId: query.cateId,
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
  };
  return request("/api/djradio/hot", data, createOption(query, "weapi"));
};

export default djRadioHot;
