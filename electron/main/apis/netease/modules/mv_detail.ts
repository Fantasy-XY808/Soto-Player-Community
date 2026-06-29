/**
 * MV 详情
 *
 * params:
 * - mvid  MV id
 *
 * 响应：`{ code, data: { id, name, artistName, artists, brs: { 240/480/720/1080: url }, desc, ... } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const mvDetail: NeteaseModule = (query, request) => {
  const data = { id: query.mvid };
  return request("/api/mv/detail", data, createOption(query, "weapi"));
};

export default mvDetail;
