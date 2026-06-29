/**
 * 每日推荐歌单 / 专属歌单（需登录）
 *
 * 响应：`{ code, recommend: NeteasePlaylist[] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const recommendResource: NeteaseModule = (query, request) => {
  return request("/api/v1/discovery/recommend/resource", {}, createOption(query, "weapi"));
};

export default recommendResource;
