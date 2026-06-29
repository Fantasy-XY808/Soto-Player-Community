/**
 * 电台详情
 *
 * params:
 * - rid  电台 id
 *
 * 响应：`{ code, djRadio: { id, name, dj, picUrl, desc, category, subCount, programCount, ... } }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djDetail: NeteaseModule = (query, request) => {
  const data = { rid: query.rid };
  return request("/api/dj/detail", data, createOption(query, "weapi"));
};

export default djDetail;
