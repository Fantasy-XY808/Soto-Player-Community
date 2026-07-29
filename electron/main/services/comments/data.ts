/**
 * 评论系统数据层
 *
 * - normalizeNeteaseComment: 把网易云原始评论字段映射为统一的 MusicCommentItem
 * - buildCommentSources: 列出 builtin:netease + 所有声明了 getMusicComments 能力的插件源
 *
 * 服务层（index.ts）通过 callNetease("comment_hot"|"comment_music", ...) 拉取原始数据，
 * 再用这里的 normalizeNeteaseComment 转成统一格式返回给渲染端。
 */

import type { CommentSource, MusicCommentItem } from "../../../../shared/types/comment";
import type { PluginInfo } from "../../../../shared/types/plugin";

/** 网易云原始评论作者字段（宽松类型，应对服务端字段缺失） */
interface NeteaseRawUser {
  userId?: number;
  nickname?: string;
  avatarUrl?: string;
}

/** 网易云原始被回复评论字段 */
interface NeteaseRawBeReplied {
  user?: NeteaseRawUser;
  content?: string;
  beRepliedCommentId?: number;
}

/** 网易云原始评论字段（宽松类型，应对服务端字段缺失） */
export interface NeteaseRawComment {
  commentId?: number;
  content?: string;
  time?: number;
  likedCount?: number;
  liked?: boolean;
  user?: NeteaseRawUser;
  beReplied?: NeteaseRawBeReplied[];
}

/** 网易云评论作者归一化 */
const toUser = (raw: NeteaseRawUser | undefined): { id: string; name: string; avatar?: string } => ({
  id: raw?.userId != null ? String(raw.userId) : "",
  name: raw?.nickname ?? "",
  avatar: raw?.avatarUrl,
});

/**
 * 把网易云原始评论映射为统一 MusicCommentItem
 *
 * 注意：commentId 在网易云响应里是 number；统一层用 string 便于跨源对齐
 * @param raw 网易云原始评论对象
 */
export const normalizeNeteaseComment = (raw: NeteaseRawComment | undefined): MusicCommentItem => {
  const safe = raw ?? {};
  const user = toUser(safe.user);
  const repliedList = Array.isArray(safe.beReplied) ? safe.beReplied : [];
  const replied = repliedList[0];
  const beReplied = repliedList.map((r) => {
    const ru = toUser(r.user);
    return {
      id: r.beRepliedCommentId != null ? String(r.beRepliedCommentId) : "",
      userName: ru.name,
      content: r.content ?? "",
      userId: ru.id || undefined,
      userAvatar: ru.avatar,
    };
  });

  return {
    id: safe.commentId != null ? String(safe.commentId) : "",
    content: safe.content ?? "",
    timestamp: safe.time ?? 0,
    userName: user.name,
    userAvatar: user.avatar,
    likedCount: safe.likedCount ?? 0,
    liked: Boolean(safe.liked),
    parent: replied
      ? {
          id: replied.beRepliedCommentId != null ? String(replied.beRepliedCommentId) : "",
          content: replied.content ?? "",
          userName: toUser(replied.user).name,
        }
      : undefined,
    beReplied: beReplied.length > 0 ? beReplied : undefined,
  };
};

/** 内置源：网易云（hot + new 两个 tab） */
const NETEASE_BUILTIN: CommentSource = {
  id: "netease",
  kind: "builtin",
  label: "网易云音乐",
  tabs: ["hot", "new"],
};

/**
 * 构造评论源列表
 *
 * - 始终包含 builtin:netease
 * - 遍历插件清单，凡 status.state==="ready" 且某 source 的 actions 包含 "getMusicComments"
 *   的插件，按 `<pluginId>:<sourceKey>` 形式加入源列表
 *
 * @param plugins 当前已安装的插件清单（来自 pluginRegistry.listInfo()）
 */
export const buildCommentSources = (plugins: PluginInfo[]): CommentSource[] => {
  const sources: CommentSource[] = [NETEASE_BUILTIN];

  for (const info of plugins) {
    if (!info.enabled) continue;
    if (info.status.state !== "ready") continue;
    const statusSources = info.status.sources ?? {};
    for (const [sourceKey, cap] of Object.entries(statusSources)) {
      if (!cap?.actions?.includes("getMusicComments")) continue;
      sources.push({
        id: `${info.manifest.id}:${sourceKey}`,
        kind: "plugin",
        label: cap.name || info.manifest.name,
        tabs: ["hot", "new"],
      });
    }
  }

  return sources;
};
