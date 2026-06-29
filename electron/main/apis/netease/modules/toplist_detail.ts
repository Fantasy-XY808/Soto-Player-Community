/**
 * 排行榜详情（含完整曲目列表）
 *
 * params:
 * - id  排行榜 id（来自 toplist.list[].id）
 *
 * 响应：`{ code, playlist: { id, name, tracks, trackIds, ... }, privileges }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const toplistDetail: NeteaseModule = (query, request) => {
  const data = { id: query.id, n: 100000, s: 8 };
  return request("/api/playlist/detail/dynamic", data, createOption(query, "weapi"));
};

export default toplistDetail;
