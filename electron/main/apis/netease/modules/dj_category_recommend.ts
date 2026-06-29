/**
 * 电台分类推荐
 *
 * params:
 * - category  分类 id（来自 dj_category 接口）
 *
 * 响应：`{ code, djRadios: [{ id, name, dj, picUrl, desc, category, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djCategoryRecommend: NeteaseModule = (query, request) => {
  const data = { category: query.category };
  return request("/api/dj/category/recommend", data, createOption(query, "weapi"));
};

export default djCategoryRecommend;
