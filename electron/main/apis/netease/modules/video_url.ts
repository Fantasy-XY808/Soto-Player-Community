/**
 * 视频播放地址
 *
 * params:
 * - id          视频 id
 * - resolution  分辨率，默认 1080（可选 1080/720/480/240）
 *
 * 响应：`{ code, urls: [{ id, url, size, resolution, ... }] }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const videoUrl: NeteaseModule = (query, request) => {
  const data = {
    ids: `[${String(query.id)}]`,
    resolution: query.resolution ?? 1080,
  };
  return request("/api/cloudvideo/playurl", data, createOption(query, "weapi"));
};

export default videoUrl;
