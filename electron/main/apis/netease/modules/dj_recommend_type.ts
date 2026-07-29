/**
 * 指定分类下的推荐电台
 *
 * params:
 * - type  分类 id（来自 dj_catelist 的 id 字段）
 *
 * 响应：`{ code, djRadios: [{ id, name, dj, picUrl, category, ... }] }`
 *
 * 端点对齐 NeteaseCloudMusicApi dj_recommend_type：`/api/djradio/recommend`，body 字段为 `cateId`
 */
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djRecommendType: NeteaseModule = (query, request) => {
  const data = { cateId: query.type };
  return request("/api/djradio/recommend", data, createOption(query, "weapi"));
};

export default djRecommendType;
