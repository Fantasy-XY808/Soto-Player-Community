import { netease as neteaseApi } from "@/apis/netease";
import { LruCache } from "@/services/lruCache";

/** 单条动态 */
export interface EventItem {
  id: string;
  type: number;
  /** 动态原始 JSON 字符串（含 song/playlist/album 等引用） */
  json: string;
  actualTime: number;
  userId: string;
  userName: string;
  userAvatar: string;
  /** 点赞数 */
  likeCount?: number;
  /** 评论数 */
  commentCount?: number;
}

/** 最近动态缓存：供 EventDetail 跳转时按 id 查找，避免重复请求 */
const recentEventsCache = new LruCache<string, EventItem>({ capacity: 100 });

/** 写入最近动态缓存（按 id 去重，超容量时自动淘汰最久未访问） */
export const cacheRecentEvents = (items: EventItem[]): void => {
  for (const item of items) {
    recentEventsCache.set(item.id, item);
  }
};

/** 按 id 取最近动态缓存 */
export const getCachedEvent = (id: string): EventItem | undefined => recentEventsCache.get(id);

/** 动态列表响应 */
export interface EventListResult {
  events: EventItem[];
  /** 下一页参数，无更多时为 -1 */
  lasttime: number;
  more: boolean;
}

interface RawEvent {
  id?: number;
  type?: number;
  json?: string;
  actualTime?: number;
  user?: {
    userId?: number;
    nickname?: string;
    avatarUrl?: string;
  };
  info?: {
    likedCount?: number;
    commentCount?: number;
    commentThreadIds?: { id?: string };
  };
}

/** 解析动态原始结构为前端模型 */
const toEventItem = (raw: RawEvent): EventItem => {
  let userName = "";
  let userAvatar = "";
  let userId = "";
  try {
    const parsed = raw.json ? JSON.parse(raw.json) : null;
    userName = parsed?.user?.nickname ?? raw.user?.nickname ?? "";
    userAvatar = parsed?.user?.avatarUrl ?? raw.user?.avatarUrl ?? "";
    userId = String(parsed?.user?.userId ?? raw.user?.userId ?? "");
  } catch {
    userName = raw.user?.nickname ?? "";
    userAvatar = raw.user?.avatarUrl ?? "";
    userId = String(raw.user?.userId ?? "");
  }
  return {
    id: String(raw.id ?? ""),
    type: raw.type ?? 0,
    json: raw.json ?? "",
    actualTime: raw.actualTime ?? 0,
    userId,
    userName,
    userAvatar,
    likeCount: raw.info?.likedCount,
    commentCount: raw.info?.commentCount,
  };
};

/**
 * 朋友圈动态
 * @param lasttime - 翻页游标，首页传 -1
 * @param pagesize - 每页数量，默认 20
 */
export const fetchEvents = async (lasttime = -1, pagesize = 20): Promise<EventListResult> => {
  const body = await neteaseApi.event<{
    event?: RawEvent[];
    lasttime?: number;
    more?: boolean;
  }>({ lasttime, pagesize });
  const events = (body?.event ?? []).map(toEventItem);
  cacheRecentEvents(events);
  return {
    events,
    lasttime: body?.lasttime ?? -1,
    more: body?.more ?? false,
  };
};
