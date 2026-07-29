/**
 * 评论系统 IPC
 *
 * 渲染端通过 `window.api.comments.*` 调用：
 * - comments:getSources                       列出可用评论源
 * - comments:getComments(query)               拉取某源某 tab 的评论
 * - comments:like(commentId, liked)           点赞/取消点赞（best-effort）
 */

import { ipcMain } from "electron";
import type {
  MusicCommentQuery,
  MusicCommentResponse,
  CommentSource,
} from "@shared/types/comment";
import { getSources, getComments, like } from "@main/services/comments";

export const registerCommentsIpc = (): void => {
  ipcMain.handle("comments:getSources", (): CommentSource[] => getSources());

  ipcMain.handle(
    "comments:getComments",
    async (_evt, query: MusicCommentQuery): Promise<MusicCommentResponse> =>
      getComments(query),
  );

  ipcMain.handle(
    "comments:like",
    async (_evt, commentId: string, liked: boolean): Promise<void> =>
      like(commentId, liked),
  );
};
