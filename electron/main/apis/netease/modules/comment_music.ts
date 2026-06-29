/**
 * 歌曲评论列表
 *
 * params:
 * - id      歌曲 id
 * - offset  分页偏移，默认 0
 * - limit   每页数量，默认 20
 * - before  分页参数：取该时间戳之前的评论
 *
 * 响应：`{ code, total, hotComments, hotMore, comments, hasMore }`
 * 服务端在首屏返回 hotComments + comments；翻页时仅返回 comments
 *
 * 加密：weapi（对齐 NCM 现行实现）
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const commentMusic: NeteaseModule = (query, request) => {
  const data: Record<string, unknown> = {
    threadId: `R_SO_4_${query.id}`,
    offset: query.offset ?? 0,
    limit: query.limit ?? 20,
  };
  if (query.before !== undefined) data.before = query.before;
  return request("/api/v1/resource/comments", data, createOption(query, "weapi"));
};

export default commentMusic;
