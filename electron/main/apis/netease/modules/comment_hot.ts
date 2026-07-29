/**
 * 热评分页模块
 *
 * 与 comment_music 共用端点 `/api/v1/resource/comments/R_SO_4_<id>`，但语义上
 * 仅取 hotComments 字段；翻页使用 `before` 游标（上一页末尾热评的 time）。
 *
 * comment_music 在首屏同时返回 hotComments + comments，对评论系统而言耦合过重；
 * 此模块提供"只取热评"的清晰入口，避免服务层重复过滤。
 *
 * params:
 * - id      歌曲 id
 * - limit   每页数量，默认 20
 * - before  分页游标：取该时间戳之前的热评
 *
 * 加密：weapi
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const commentHot: NeteaseModule = (query, request) => {
  const data: Record<string, unknown> = {
    limit: query.limit ?? 20,
  };
  if (query.before !== undefined) data.before = query.before;
  return request(
    `/api/v1/resource/comments/R_SO_4_${query.id}`,
    data,
    createOption(query, "weapi"),
  );
};

export default commentHot;
