/**
 * 调整"我的歌单"显示顺序（仅自建）
 *
 * params:
 * - ids  期望顺序的歌单 id 数组（JSON 字符串）
 *
 * 响应：`{ code }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const playlistOrderUpdate: NeteaseModule = (query, request) => {
  const data = { ids: query.ids };
  return request("/api/playlist/order/update", data, createOption(query, "weapi"));
};

export default playlistOrderUpdate;
