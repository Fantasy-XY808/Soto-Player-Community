/**
 * 动态评论列表
 *
 * params:
 * - eventId  动态 id（threadId 形如 R_EV_4_<eventId>）
 * - cursor   翻页游标（实际作为 offset 传给服务端，默认 0）
 * - limit    每页数量，默认 20
 *
 * 响应：`{ code, total, comments, hasMore, hotComments, ... }`
 *
 * 加密：weapi
 *
 * 端点：`/api/v1/resource/comments/R_EV_4_<eventId>`，与 comment_music 同源
 * （网易云所有评论接口统一遵循 `/api/v1/resource/comments/<threadId>` 约定，
 * threadId 前缀 `R_EV_4_` 是动态评论的官方约定）。
 * 字段命名与 comment_music / comment_floor 一致：服务端返回 `hasMore`。
 * 翻页采用 offset 语义；非 200 业务码由 createRequest 抛 NeteaseRequestError。
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const commentEvent: NeteaseModule = (query, request) => {
  const threadId = `R_EV_4_${query.eventId}`;
  const data: Record<string, unknown> = {
    offset: query.cursor ?? 0,
    limit: query.limit ?? 20,
  };
  return request(
    `/api/v1/resource/comments/${threadId}`,
    data,
    createOption(query, "weapi"),
  );
};

export default commentEvent;
