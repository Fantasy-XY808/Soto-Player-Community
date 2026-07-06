/**
 * 视频分类列表
 *
 * 响应：`{ code, data: [{ id, name, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const videoCategoryList: NeteaseModule = (_query, request) => {
  const data = {};
  return request("/api/cloudvideo/category/list", data, createOption(_query, "weapi"));
};

export default videoCategoryList;
