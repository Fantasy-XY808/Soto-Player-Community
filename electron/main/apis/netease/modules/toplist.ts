/**
 * 排行榜列表（所有官方榜）
 *
 * 响应：`{ code, list: [{ id, name, description, updateFrequency, trackCount, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const toplist: NeteaseModule = (query, request) => {
  return request("/api/toplist", {}, createOption(query, "weapi"));
};

export default toplist;
