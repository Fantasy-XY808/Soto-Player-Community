/**
 * 个性化推荐电台
 *
 * 响应：`{ code, data: { dailyRecommendRdios: [{ id, name, dj, picUrl, ... }] } }`
 *
 * 用于首页"为你推荐"区块（若启用）
 *
 * 端点对齐 NeteaseCloudMusicApi dj_personalize_recommend：`/api/djradio/personalize/rcmd`
 */
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djPersonalize: NeteaseModule = (query, request) => {
  const data = { limit: query.limit ?? 6 };
  return request("/api/djradio/personalize/rcmd", data, createOption(query, "weapi"));
};

export default djPersonalize;
