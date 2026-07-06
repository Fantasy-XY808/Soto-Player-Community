/**
 * 视频分组列表
 *
 * 响应：`{ code, data: [{ id, name, type, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const videoGroupList: NeteaseModule = (_query, request) => {
  const data = {};
  return request("/api/cloudvideo/group/list", data, createOption(_query, "weapi"));
};

export default videoGroupList;
