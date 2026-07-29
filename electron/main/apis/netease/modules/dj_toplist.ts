/**
 * 电台排行榜（新晋榜 / 热门榜）
 *
 * params:
 * - type    "new" 新晋榜 / "hot" 热门榜
 * - limit   返回数量，默认 30
 * - offset  偏移量，默认 0
 *
 * 响应：`{ code, toplist: [{ id, name, dj, picUrl, category, ... }] }`
 *
 * 端点对齐 NeteaseCloudMusicApi dj_toplist：
 *   `/api/djradio/toplist`，type 为数字（0=新晋榜 / 1=热门榜）
 */
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const TYPE_MAP: Record<string, number> = { new: 0, hot: 1 };

const djToplist: NeteaseModule = (query, request) => {
  const typeKey = (query.type as string | undefined) ?? "hot";
  const data = {
    type: TYPE_MAP[typeKey] ?? 1,
    limit: query.limit ?? 30,
    offset: query.offset ?? 0,
  };
  return request("/api/djradio/toplist", data, createOption(query, "weapi"));
};

export default djToplist;
