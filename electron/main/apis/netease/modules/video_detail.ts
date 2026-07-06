/**
 * 视频详情
 *
 * params:
 * - id  视频 id
 *
 * 响应：`{ code, data: { id, name, cover, duration, playTime, desc, artists, tags, ... } }`
 * 与 MV 不同：视频是用户上传内容，MV 是官方音乐视频
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const videoDetail: NeteaseModule = (query, request) => {
  const data = { id: query.id };
  return request("/api/cloudvideo/v1/video/detail", data, createOption(query, "weapi"));
};

export default videoDetail;
