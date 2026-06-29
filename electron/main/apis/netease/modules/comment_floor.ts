/**
 * 楼层评论（歌曲评论区指定楼层的子评论）
 *
 * params:
 * - id          歌曲 id
 * - parentCommentId  父评论 id
 * - limit       每页数量，默认 30
 * - time       分页游标，默认 -1
 *
 * 响应：`{ code, data: { comments, hasMore, totalCount, time } }`
 *
 * 加密：weapi
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const commentFloor: NeteaseModule = (query, request) => {
  const data = {
    parentCommentId: query.parentCommentId,
    threadId: `R_SO_4_${query.id}`,
    time: query.time ?? -1,
    limit: query.limit ?? 30,
  };
  return request("/api/v1/resource/comment/floor/get", data, createOption(query, "weapi"));
};

export default commentFloor;
