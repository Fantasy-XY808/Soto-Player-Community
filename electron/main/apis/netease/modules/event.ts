/**
 * 朋友圈动态（关注的人的动态）
 *
 * params:
 * - pagesize   每页数量，默认 20
 * - lasttime   上次返回的 lasttime 值，用于翻页；首页传 -1 或不传
 *
 * 响应：`{ code, event: [{ id, type, json, actualTime, user, ... }], lasttime, more, more2 }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const event: NeteaseModule = (query, request) => {
  const data = {
    pagesize: query.pagesize ?? 20,
    lasttime: query.lasttime ?? -1,
  };
  return request("/api/event/get", data, createOption(query, "weapi"));
};

export default event;
