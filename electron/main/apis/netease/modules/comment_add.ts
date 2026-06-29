/**
 * 发送评论
 *
 * params:
 * - id        歌曲 id
 * - content   评论内容
 * - threadId  可选；不传则用 R_SO_4_<id>
 * - replyCommentId  回复某条评论时传其 id
 *
 * 响应：`{ code, comment }`，常见失败码：
 * - 405 需要验证码
 * - 250 含敏感词
 * - 404 无权限（如未登录）
 *
 * 加密：weapi
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const commentAdd: NeteaseModule = (query, request) => {
  const threadId = query.threadId ?? `R_SO_4_${query.id}`;
  const data: Record<string, unknown> = {
    threadId,
    content: query.content,
  };
  if (query.replyCommentId !== undefined) data.commentId = query.replyCommentId;
  return request("/api/v1/resource/comments/add", data, createOption(query, "weapi"));
};

export default commentAdd;
