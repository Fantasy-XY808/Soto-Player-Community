/**
 * 评论系统服务入口
 *
 * 对接 CommentsApi：
 * - getSources(): 列出 builtin:netease + 所有声明 getMusicComments 能力的插件源
 * - getComments(query): 按 sourceId 路由到 builtin 或 plugin 实现
 * - like(commentId, liked): 当前为 best-effort，仅清缓存
 *
 * builtin:netease 走 callNetease("comment_music"|"comment_hot", ...)；
 * plugin:* 走 mfGetMusicComments（MusicFree 协议）并归一化为 MusicCommentItem。
 */

import { callNetease, invalidateNeteaseCache } from "@main/apis/netease";
import { pluginRegistry } from "@main/plugins/registry";
import { mfGetMusicComments } from "@main/plugins/router";
import type {
  CommentSource,
  MusicCommentItem,
  MusicCommentPage,
  MusicCommentQuery,
  MusicCommentResponse,
} from "../../../../shared/types/comment";
import {
  buildCommentSources,
  normalizeNeteaseComment,
  type NeteaseRawComment,
} from "./data";

const NETEASE_DEFAULT_PAGE_SIZE = 20;

/** 解析 sourceId：builtin:netease 或 plugin:<pluginId>:<sourceKey> */
const parseSourceId = (
  sourceId: string,
): { kind: "builtin" } | { kind: "plugin"; pluginId: string; sourceKey: string } => {
  if (sourceId === "netease") return { kind: "builtin" };
  const sepIdx = sourceId.indexOf(":");
  if (sepIdx <= 0) throw new Error(`unknown comment source: ${sourceId}`);
  return {
    kind: "plugin",
    pluginId: sourceId.slice(0, sepIdx),
    sourceKey: sourceId.slice(sepIdx + 1),
  };
};

/** 列出所有可用评论源 */
export const getSources = (): CommentSource[] =>
  buildCommentSources(pluginRegistry.listInfo());

/** 拉取评论 */
export const getComments = async (
  query: MusicCommentQuery,
): Promise<MusicCommentResponse> => {
  const parsed = parseSourceId(query.sourceId);
  if (parsed.kind === "builtin") {
    return fetchNeteaseComments(query);
  }
  return fetchPluginComments(parsed.pluginId, query);
};

/** 网易云评论（builtin:netease） */
const fetchNeteaseComments = async (
  query: MusicCommentQuery,
): Promise<MusicCommentResponse> => {
  const pageSize = query.pageSize ?? NETEASE_DEFAULT_PAGE_SIZE;
  const offset = (query.page - 1) * pageSize;
  const res = await callNetease("comment_music", {
    id: query.trackId,
    offset,
    limit: pageSize,
  });
  const body = (res.body ?? {}) as Record<string, unknown>;
  const rawList: NeteaseRawComment[] =
    query.tab === "hot"
      ? ((body.hotComments as NeteaseRawComment[]) ?? [])
      : ((body.comments as NeteaseRawComment[]) ?? []);
  const items: MusicCommentItem[] = rawList.map(normalizeNeteaseComment);
  const page: MusicCommentPage = {
    items,
    total: (body.total as number) ?? 0,
    page: query.page,
    hasMore:
      query.tab === "hot" ? Boolean(body.moreHot) : Boolean(body.hasMore),
  };
  return { page, sources: getSources() };
};

/**
 * 插件源评论（plugin:*）
 *
 * 复用 MusicFree 协议入口 mfGetMusicComments；插件返回的 MfComment[] 在此归一化为
 * MusicCommentItem。tab 字段对 MusicFree 协议不透明——插件侧自行决定如何处理。
 */
const fetchPluginComments = async (
  pluginId: string,
  query: MusicCommentQuery,
): Promise<MusicCommentResponse> => {
  const mfRes = await mfGetMusicComments(
    pluginId,
    { id: query.trackId, platform: "", title: "" },
    query.page,
  );
  const rawComments = (mfRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const items: MusicCommentItem[] = rawComments.map((c) => ({
    id: typeof c.id === "string" ? c.id : String(c.id ?? ""),
    content: typeof c.comment === "string" ? c.comment : "",
    timestamp: typeof c.createAt === "number" ? c.createAt : 0,
    userName: typeof c.nickName === "string" ? c.nickName : "",
    userAvatar: typeof c.avatar === "string" ? c.avatar : undefined,
    likedCount: typeof c.like === "number" ? c.like : 0,
    liked: false,
  }));
  const page: MusicCommentPage = {
    items,
    total: items.length,
    page: query.page,
    hasMore: !mfRes.isEnd,
  };
  return { page, sources: getSources() };
};

/**
 * 点赞/取消点赞
 *
 * 注：CommentsApi.like(commentId, liked) 签名未携带 sourceId/songId，
 * 这里仅做缓存失效；实际点赞由渲染端通过 apis.call("netease", "comment_like", ...) 完成。
 */
export const like = async (_commentId: string, _liked: boolean): Promise<void> => {
  invalidateNeteaseCache("comment_music");
};
