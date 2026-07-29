/**
 * 评论系统共享类型
 *
 * CommentSource 抽象支持两类源：
 * - builtin:netease 等内置源
 * - plugin:* 自定义插件源（通过 MusicCommentReq/Res 走插件协议）
 */

export type CommentSourceKind = "builtin" | "plugin";

export interface CommentSource {
  id: string;
  kind: CommentSourceKind;
  label: string;
  tabs: CommentTab[];
  icon?: string;
}

export type CommentTab = "hot" | "new";

/** 被引用/被回复的评论（归一化字段，跨平台通用） */
export interface MusicCommentReply {
  id: string;
  userName: string;
  content: string;
  userId?: string;
  userAvatar?: string;
}

export interface MusicCommentItem {
  id: string;
  content: string;
  timestamp: number;
  userName: string;
  userAvatar?: string;
  likedCount: number;
  liked?: boolean;
  /**
   * 兼容旧字段：单条被回复评论（取 beReplied[0]）
   * @deprecated 优先使用 beReplied 数组
   */
  parent?: Pick<MusicCommentItem, "id" | "content" | "userName">;
  /** 被回复/被引用的评论列表（归一化字段，网易云 beReplied 已映射到此） */
  beReplied?: MusicCommentReply[];
}

export interface MusicCommentPage {
  items: MusicCommentItem[];
  total: number;
  page: number;
  hasMore: boolean;
}

export interface MusicCommentQuery {
  sourceId: string;
  trackId: string;
  tab: CommentTab;
  page: number;
  pageSize?: number;
}

export interface MusicCommentResponse {
  page: MusicCommentPage;
  sources?: CommentSource[];
}

export interface CommentsApi {
  getSources: () => Promise<CommentSource[]>;
  getComments: (query: MusicCommentQuery) => Promise<MusicCommentResponse>;
  like: (commentId: string, liked: boolean) => Promise<void>;
}
