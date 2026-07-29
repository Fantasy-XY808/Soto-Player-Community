import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  CommentSource,
  CommentSourceKind,
  CommentTab,
  MusicCommentItem,
  MusicCommentPage,
  MusicCommentQuery,
  MusicCommentResponse,
  CommentsApi,
} from "../../shared/types/comment.js";

test("评论系统类型可被引用", () => {
  const _a: CommentSource = {} as CommentSource;
  const _b: CommentSourceKind = "builtin";
  const _c: CommentTab = "hot";
  const _d: MusicCommentItem = {} as MusicCommentItem;
  const _e: MusicCommentPage = {} as MusicCommentPage;
  const _f: MusicCommentQuery = {} as MusicCommentQuery;
  const _g: MusicCommentResponse = {} as MusicCommentResponse;
  const _h: CommentsApi = {} as CommentsApi;
  assert.ok(_a && _b && _c && _d && _e && _f && _g && _h);
});

test("comment.ts 模块文件存在（运行时导入）", async () => {
  // 动态导入验证文件真实存在；import type 会被擦除，无法验证文件缺失
  await import("../../shared/types/comment.js");
  assert.ok(true);
});
