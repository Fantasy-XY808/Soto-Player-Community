/**
 * 删除评论
 *
 * params:
 * - id     歌曲 id
 * - cid    评论 id
 *
 * 响应：`{ code }`，code !== 200 表示失败
 *
 * 加密：weapi
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const commentDelete: NeteaseModule = (query, request) => {
  const data = {
    threadId: `R_SO_4_${query.id}`,
    commentId: query.cid,
  };
  return request("/api/v1/resource/comments/delete", data, createOption(query, "weapi"));
};

export default commentDelete;
