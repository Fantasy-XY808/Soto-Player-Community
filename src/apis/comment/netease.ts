/**
 * 网易云歌曲评论 API
 *
 * 主进程模块：comment_music / comment_floor / comment_like / comment_add / comment_delete
 * 评论内容可能含 HTML 实体，统一在 toComment 中解码
 */

import { netease as neteaseApi } from "@/apis/netease";

/** 网易云评论作者 */
export interface NeteaseCommentUser {
  userId: number;
  nickname: string;
  avatarUrl?: string;
}

/** 网易云被回复评论 */
export interface NeteaseBeReplied {
  user: NeteaseCommentUser;
  content: string;
}

/** 网易云评论 */
export interface NeteaseComment {
  commentId: number;
  content: string;
  time: number;
  likedCount: number;
  liked: boolean;
  user: NeteaseCommentUser;
  beReplied?: NeteaseBeReplied[];
}

/** 歌曲评论响应 */
export interface NeteaseSongComments {
  total: number;
  hotComments: NeteaseComment[];
  comments: NeteaseComment[];
  hasMore: boolean;
  moreHot: boolean;
}

/** 楼层评论响应 */
export interface NeteaseFloorComments {
  comments: NeteaseComment[];
  hasMore: boolean;
  totalCount: number;
}

/** 解析评论作者 */
const toUser = (raw: any): NeteaseCommentUser => ({
  userId: raw?.userId ?? 0,
  nickname: raw?.nickname ?? "",
  avatarUrl: raw?.avatarUrl ?? undefined,
});

/** HTML 实体解码（评论内容里 &#039; &amp; 等很常见） */
const decodeHtml = (str: string): string => {
  if (!str) return "";
  const ta = document.createElement("textarea");
  ta.innerHTML = str;
  return ta.value;
};

/** 解析单条评论 */
const toComment = (raw: any): NeteaseComment => ({
  commentId: raw?.commentId ?? 0,
  content: decodeHtml(raw?.content ?? ""),
  time: raw?.time ?? 0,
  likedCount: raw?.likedCount ?? 0,
  liked: !!raw?.liked,
  user: toUser(raw?.user),
  beReplied: Array.isArray(raw?.beReplied)
    ? raw.beReplied.map((b: any) => ({
        user: toUser(b?.user),
        content: decodeHtml(b?.content ?? ""),
      }))
    : undefined,
});

/**
 * 拉取歌曲评论
 * @param songId 歌曲 id
 * @param opts 分页参数
 */
export const fetchSongComments = async (
  songId: string | number,
  opts: { offset?: number; limit?: number; before?: number } = {},
): Promise<NeteaseSongComments> => {
  const body = await neteaseApi.comment_music({
    id: songId,
    offset: opts.offset,
    limit: opts.limit,
    before: opts.before,
  });
  return {
    total: body?.total ?? 0,
    hotComments: (body?.hotComments ?? []).map(toComment),
    comments: (body?.comments ?? []).map(toComment),
    hasMore: !!body?.hasMore,
    moreHot: !!body?.moreHot,
  };
};

/**
 * 拉取楼层评论
 * @param songId 歌曲 id
 * @param parentCommentId 父评论 id
 * @param opts 分页参数
 */
export const fetchFloorComments = async (
  songId: string | number,
  parentCommentId: number,
  opts: { limit?: number; time?: number } = {},
): Promise<NeteaseFloorComments> => {
  const body = await neteaseApi.comment_floor({
    id: songId,
    parentCommentId,
    limit: opts.limit,
    time: opts.time,
  });
  return {
    comments: (body?.data?.comments ?? []).map(toComment),
    hasMore: !!body?.data?.hasMore,
    totalCount: body?.data?.totalCount ?? 0,
  };
};

/**
 * 点赞 / 取消点赞评论
 * @param songId 歌曲 id
 * @param commentId 评论 id
 * @param like true 点赞 / false 取消
 */
export const toggleCommentLike = async (
  songId: string | number,
  commentId: number,
  like: boolean,
): Promise<void> => {
  await neteaseApi.comment_like({ id: songId, cid: commentId, t: like ? 1 : 0 });
};

/** 发送评论失败的扩展错误，携带原始业务码供 UI 区分 */
export class NeteaseCommentAddError extends Error {
  /** 业务码：405 验证码 / 250 敏感词 / 404 无权限 等 */
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "NeteaseCommentAddError";
    this.code = code;
  }
}

/** 从 `netease <code>: <msg>` 风格的 message 中提取业务码 */
const parseErrorCode = (err: unknown): number => {
  if (err instanceof Error) {
    const m = err.message.match(/^netease\s+(\d+)/);
    if (m) return Number(m[1]);
  }
  return 0;
};

/**
 * 发送评论
 * @param songId 歌曲 id
 * @param content 评论内容
 * @param replyCommentId 回复某条评论时传其 id
 * @throws NeteaseCommentAddError 业务失败时（405/250/404 等）
 */
export const sendSongComment = async (
  songId: string | number,
  content: string,
  replyCommentId?: number,
): Promise<void> => {
  try {
    await neteaseApi.comment_add({
      id: songId,
      content,
      replyCommentId,
    });
  } catch (err) {
    throw new NeteaseCommentAddError(
      parseErrorCode(err),
      err instanceof Error ? err.message : String(err),
    );
  }
};

/**
 * 删除评论
 * @param songId 歌曲 id
 * @param commentId 评论 id
 */
export const deleteSongComment = async (
  songId: string | number,
  commentId: number,
): Promise<void> => {
  await neteaseApi.comment_delete({ id: songId, cid: commentId });
};
