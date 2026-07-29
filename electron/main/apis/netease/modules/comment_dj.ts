/**
 * 电台节目评论列表
 *
 * params:
 * - programId  电台节目 id（threadId 形如 R_DJ_5_<programId>）
 * - offset     翻页偏移，默认 0
 * - limit      每页数量，默认 20
 *
 * 响应：`{ code, total, comments, hasMore, hotComments, ... }`
 *
 * 加密：weapi
 *
 * 端点：`/api/v1/resource/comments/R_DJ_5_<programId>`，与 comment_music / comment_event 同源
 * threadId 前缀 `R_DJ_5_` 是网易云电台节目评论的官方约定。
 */
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const commentDj: NeteaseModule = (query, request) => {
  const threadId = `R_DJ_5_${query.programId}`;
  const data: Record<string, unknown> = {
    offset: query.offset ?? 0,
    limit: query.limit ?? 20,
  };
  return request(
    `/api/v1/resource/comments/${threadId}`,
    data,
    createOption(query, "weapi"),
  );
};

export default commentDj;
