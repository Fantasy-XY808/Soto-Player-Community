/**
 * 评论点赞 / 取消点赞
 *
 * params:
 * - id      歌曲 id
 * - cid     评论 id
 * - t       1 点赞 / 0 取消，默认 1
 * - type    资源类型，默认 0（歌曲 / R_SO_4_）
 *
 * 响应：`{ code }`，code !== 200 表示失败
 *
 * 加密：weapi
 *
 * 注意：type 必须与 threadId 前缀匹配——R_SO_4_ 对应歌曲，type=0；
 * 旧实现默认 type=2（专辑），与 R_SO_4_ 不匹配导致点赞必然失败
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const commentLike: NeteaseModule = (query, request) => {
  const t = query.t === 0 || query.t === "0" ? 0 : 1;
  const type = query.type ?? 0;
  const data = {
    threadId: `R_SO_4_${query.id}`,
    commentId: query.cid,
    cid: query.cid,
    t,
    type,
  };
  return request("/api/v1/comment/like", data, createOption(query, "weapi"));
};

export default commentLike;
