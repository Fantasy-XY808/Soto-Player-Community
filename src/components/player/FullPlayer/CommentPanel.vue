<script setup lang="ts">
/**
 * 歌曲评论面板
 *
 * 顶部热评 + 底部最新评论分页；底部输入框 + 发送按钮
 * 错误码：405 验证码 / 250 敏感词 / 404 无权限
 *
 * 虚拟滚动采用动态高度：ResizeObserver 测量每条评论真实高度，存到 module 级 Map，
 * FullPlayer 卸载后再次进入仍可命中（切歌回来不会闪烁）；
 * 滚动条按 sum(heights) 撑开，可见区间按累积高度二分查找
 *
 * 容器：亚克力底框 — surface-panel 半透明 + 封面色染色 + 强模糊饱和，
 * 颜色随当前封面与主题色融合，任意封面亮度下文字可读；
 * 根容器重置 --ce-auto-active: 0，禁用 auto 文字色切换，由底框保证对比度
 */

import type { NeteaseComment } from "@/apis/comment/netease";
import {
  fetchFloorComments,
  fetchHotComments,
  fetchSongComments,
  NeteaseCommentAddError,
  sendSongComment,
  toggleCommentLike,
} from "@/apis/comment/netease";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";

const props = defineProps<{
  /** 当前歌曲 id（网易云） */
  songId: string | undefined;
  /** 当前歌曲标题 */
  songTitle: string | undefined;
}>();

defineEmits<{ close: [] }>();

const { t } = useI18n();
const user = useUserStore();

/** 每页拉取数量 */
const PAGE_LIMIT = 50;
/** 项预估高度（未测量前的初值，也是模块级 Map 的兜底） */
const ITEM_ESTIMATE = 96;
/** 上下额外渲染的缓冲项数 */
const BUFFER = 4;
/** 触底加载阈值：与动态高度配合，避免触底前未触发 */
const REACH_BOTTOM_THRESHOLD = 600;
/** 模块级缓存上限：避免无限增长 */
const CACHE_LIMIT = 30;

/** 缓存条目 */
interface CommentCacheEntry {
  hot: NeteaseComment[];
  latest: NeteaseComment[];
  total: number;
  hasMore: boolean;
  moreHot: boolean;
}

/**
 * 模块级评论缓存：songId → 缓存条目
 *
 * 提升到模块级以避免 FullPlayer 卸载即销毁；切歌回来时即时显示
 */
const commentCache = new Map<string, CommentCacheEntry>();

/** 写入缓存，超限时按插入序淘汰 */
const putCache = (songId: string, entry: CommentCacheEntry): void => {
  commentCache.set(songId, entry);
  if (commentCache.size > CACHE_LIMIT) {
    const oldest = commentCache.keys().next().value;
    if (oldest) commentCache.delete(oldest);
  }
};

/** 删除单个 songId 缓存条目（发送评论后调用，确保下次拉到新数据） */
const deleteCache = (songId: string): void => {
  commentCache.delete(songId);
};

/** 模块级高度缓存：`${songId}:${commentId}` → height */
const heightCache = new Map<string, number>();

/** 取高度缓存 key */
const heightKey = (songId: string, commentId: number): string => `${songId}:${commentId}`;

/** 热评列表 */
const hotComments = shallowRef<NeteaseComment[]>([]);
/** 最新评论列表 */
const latestComments = shallowRef<NeteaseComment[]>([]);
/** 合并列表（热评 + 最新），用于虚拟滚动统一渲染 */
const allComments = computed(() => [...hotComments.value, ...latestComments.value]);
/** 热评数量（用于虚拟滚动中区分分区标题） */
const hotCount = computed(() => hotComments.value.length);
/** 总评论数 */
const total = ref(0);
/** 最新评论是否还有更多 */
const hasMore = ref(false);
/** 热评是否还有更多（首屏 moreHot） */
const moreHot = ref(false);
/** 是否在加载（首屏） */
const loading = ref(false);
/** 是否在加载更多最新评论 */
const loadingMore = ref(false);
/** 是否在加载更多热评 */
const loadingMoreHot = ref(false);
/** 是否在发送 */
const sending = ref(false);
/** 首屏加载错误信息（null 表示无错误） */
const loadError = ref<string | null>(null);
/** 输入框内容 */
const inputContent = ref("");

/** 拉取中的 songId，防止切歌竞态覆盖 */
let loadingSongId = "";

/** 楼层展开状态：parentCommentId → { replies, expanded, loading, hasMore, error } */
interface FloorState {
  replies: NeteaseComment[];
  expanded: boolean;
  loading: boolean;
  hasMore: boolean;
  totalCount: number;
  error: boolean;
  /** 下一页 time 游标 */
  cursor: number;
}
const floorStates = shallowRef<Map<number, FloorState>>(new Map());

/** 点赞 in-flight 集合，防止快速连点 */
const likingIds = new Set<number>();

/** 滚动容器 ref */
const scrollRef = ref<HTMLDivElement | null>(null);
/** 内容容器 ref（用于 ResizeObserver） */
const contentRef = ref<HTMLDivElement | null>(null);
/** 项容器 ref（用于 ResizeObserver 测量） */
const itemRefs = ref<HTMLElement[]>([]);

/** 每项高度数组（按 allComments 索引对应） */
const itemHeights = shallowRef<number[]>([]);
/** 每项顶部偏移（累积高度） */
const itemTops = shallowRef<number[]>([]);

/** 可见区域起始索引 */
const visibleStart = ref(0);
/** 可见区域结束索引 */
const visibleEnd = ref(0);

/** ResizeObserver 实例（懒创建） */
let resizeObserver: ResizeObserver | null = null;

/** 确保 ResizeObserver 已创建并观察 contentRef 子项 */
const ensureObserver = (): ResizeObserver => {
  if (resizeObserver) return resizeObserver;
  resizeObserver = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      const idx = Number(el.dataset.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= itemHeights.value.length) continue;
      const h = entry.contentRect.height;
      if (h > 0 && Math.abs(itemHeights.value[idx] - h) > 0.5) {
        itemHeights.value[idx] = h;
        changed = true;
        // 同步写入模块级缓存
        const c = allComments.value[idx];
        if (c && props.songId) {
          heightCache.set(heightKey(props.songId, c.commentId), h);
        }
      }
    }
    if (changed) {
      triggerRef(itemHeights);
      updateTopsFrom(0);
      recalcVisibleRange();
    }
  });
  return resizeObserver;
};

/** 从指定索引开始重算累积位置（简单线性累加，长度通常 ≤ 数百） */
const updateTopsFrom = (from: number): void => {
  const heights = itemHeights.value;
  const tops =
    itemTops.value.length === heights.length ? itemTops.value : new Array<number>(heights.length);
  let top = from > 0 ? tops[from - 1] + heights[from - 1] : 0;
  for (let i = from; i < heights.length; i++) {
    tops[i] = top;
    top += heights[i];
  }
  itemTops.value = tops;
};

/** 初始化高度数组（保留已测量值） */
const initializeHeights = (): void => {
  const all = allComments.value;
  const len = all.length;
  const heights = new Array<number>(len);
  for (let i = 0; i < len; i++) {
    const c = all[i];
    const cached = props.songId ? heightCache.get(heightKey(props.songId, c.commentId)) : undefined;
    heights[i] = cached ?? ITEM_ESTIMATE;
  }
  itemHeights.value = heights;
  updateTopsFrom(0);
};

/** 重新观察已挂载的可见项 DOM */
const observeVisibleItems = (): void => {
  if (!contentRef.value) return;
  const ob = ensureObserver();
  for (const el of itemRefs.value) {
    if (el) ob.observe(el);
  }
};

/** 总高度：sum(heights) */
const totalHeight = computed(() => {
  const heights = itemHeights.value;
  if (heights.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < heights.length; i++) sum += heights[i];
  return sum;
});

/** 顶部偏移：可见区域起始项的累积高度 */
const offsetY = computed(() => {
  const start = visibleStart.value;
  if (start <= 0) return 0;
  const tops = itemTops.value;
  const heights = itemHeights.value;
  if (start - 1 >= tops.length) return 0;
  return (tops[start - 1] ?? 0) + (heights[start - 1] ?? 0);
});

/** 重新计算可见区间（按累积高度二分查找） */
const recalcVisibleRange = (): void => {
  const el = scrollRef.value;
  if (!el) return;
  const tops = itemTops.value;
  const heights = itemHeights.value;
  const len = tops.length;
  if (len === 0) {
    visibleStart.value = 0;
    visibleEnd.value = 0;
    return;
  }
  const scrollTop = el.scrollTop;
  const viewHeight = el.clientHeight;
  // 二分查找第一个 bottom > scrollTop 的项
  let lo = 0;
  let hi = len - 1;
  let start = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (tops[mid] + heights[mid] > scrollTop) {
      start = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  // 二分查找最后一个 top <= scrollTop + viewHeight 的项
  const viewportBottom = scrollTop + viewHeight;
  lo = start;
  hi = len - 1;
  let end = start;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (tops[mid] <= viewportBottom) {
      end = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  visibleStart.value = Math.max(0, start - BUFFER);
  visibleEnd.value = Math.min(len, end + 1 + BUFFER);
};

/** 可见项切片 */
const visibleComments = computed(() => {
  const all = allComments.value;
  const start = visibleStart.value;
  const end = visibleEnd.value;
  return all.slice(start, end).map((comment, i) => ({
    comment,
    isHot: start + i < hotCount.value,
    index: start + i,
  }));
});

/** 从 `netease <code>: ...` 风格的错误信息中提取业务码 */
const parseNeteaseCode = (err: unknown): number => {
  if (err instanceof Error) {
    const m = err.message.match(/^netease\s+(-?\d+)/);
    if (m) return Number(m[1]);
  }
  return 0;
};

/** 评论加载失败的精细化提示：区分未登录 / 风控 / 网络 */
const commentLoadErrorMessage = (err: unknown): string => {
  const code = parseNeteaseCode(err);
  if (code === 301 || code === -100) return t("comment.loadingFailedAuth");
  if (code === -460 || code === 512 || code === 508) return t("comment.loadingFailedRisk");
  if (code === 502) return t("comment.loadingFailedNetwork");
  return t("comment.loadingFailed");
};

/** 首屏拉取热评 + 第一页最新评论 */
const loadFirst = async (songId: string): Promise<void> => {
  // 优先从缓存恢复（切歌回来时即时显示）
  const cached = commentCache.get(songId);
  if (cached) {
    hotComments.value = cached.hot;
    latestComments.value = cached.latest;
    total.value = cached.total;
    hasMore.value = cached.hasMore;
    moreHot.value = cached.moreHot;
    // 后台静默刷新
    void loadFirstFresh(songId);
    return;
  }
  await loadFirstFresh(songId);
};

/** 实际从网络拉取首屏 */
const loadFirstFresh = async (songId: string): Promise<void> => {
  loading.value = true;
  loadError.value = null;
  try {
    const resp = await fetchSongComments(songId, { limit: PAGE_LIMIT, offset: 0 });
    if (loadingSongId !== songId) return;
    hotComments.value = resp.hotComments;
    latestComments.value = resp.comments;
    total.value = resp.total;
    hasMore.value = resp.hasMore;
    moreHot.value = resp.moreHot;
    putCache(songId, {
      hot: resp.hotComments,
      latest: resp.comments,
      total: resp.total,
      hasMore: resp.hasMore,
      moreHot: resp.moreHot,
    });
  } catch (err) {
    console.warn("[CommentPanel] load first failed:", err);
    loadError.value = commentLoadErrorMessage(err);
    toast.error(loadError.value);
  } finally {
    loading.value = false;
  }
};

/** 重试首屏加载 */
const retryFirst = (): void => {
  if (!props.songId) return;
  void loadFirstFresh(props.songId);
};

/** 加载更多最新评论：只用 offset + limit，不传 before 避免与服务端语义冲突 */
const loadMore = async (): Promise<void> => {
  if (!props.songId || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const resp = await fetchSongComments(props.songId, {
      limit: PAGE_LIMIT,
      offset: latestComments.value.length,
    });
    if (loadingSongId !== props.songId) return;
    latestComments.value = [...latestComments.value, ...resp.comments];
    hasMore.value = resp.hasMore;
    // 更新缓存
    const cached = commentCache.get(props.songId);
    if (cached) {
      cached.latest = [...cached.latest, ...resp.comments];
      cached.hasMore = resp.hasMore;
    }
  } catch (err) {
    console.warn("[CommentPanel] load more failed:", err);
    toast.error(commentLoadErrorMessage(err));
  } finally {
    loadingMore.value = false;
  }
};

/** 加载更多热评：用 before 游标翻页 */
const loadMoreHot = async (): Promise<void> => {
  if (!props.songId || loadingMoreHot.value || !moreHot.value) return;
  loadingMoreHot.value = true;
  try {
    const last = hotComments.value[hotComments.value.length - 1];
    const resp = await fetchHotComments(props.songId, {
      limit: PAGE_LIMIT,
      before: last?.time,
    });
    if (loadingSongId !== props.songId) return;
    hotComments.value = [...hotComments.value, ...resp.hotComments];
    moreHot.value = resp.hasMore;
    const cached = commentCache.get(props.songId);
    if (cached) {
      cached.hot = [...cached.hot, ...resp.hotComments];
      cached.moreHot = resp.hasMore;
    }
  } catch (err) {
    console.warn("[CommentPanel] load more hot failed:", err);
    toast.error(commentLoadErrorMessage(err));
  } finally {
    loadingMoreHot.value = false;
  }
};

/** 滚动事件：用 requestAnimationFrame 节流，避免高频滚动卡顿 */
let scrollRafId: number | null = null;
const onScroll = (): void => {
  if (scrollRafId !== null) return;
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null;
    const el = scrollRef.value;
    if (!el) return;
    recalcVisibleRange();
    // 触底预加载
    const scrollBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (scrollBottom < REACH_BOTTOM_THRESHOLD && hasMore.value && !loadingMore.value) {
      void loadMore();
    }
  });
};

/** 展开 / 收起楼层回复 */
const toggleFloor = async (parent: NeteaseComment): Promise<void> => {
  if (!props.songId) return;
  const state = floorStates.value.get(parent.commentId);
  if (state?.expanded) {
    // 已展开 → 收起（保留 replies，再次展开时无需重新拉取）
    const next = new Map(floorStates.value);
    next.set(parent.commentId, { ...state, expanded: false });
    floorStates.value = next;
    return;
  }
  // 已有缓存回复 → 直接展开
  if (state && state.replies.length > 0) {
    const next = new Map(floorStates.value);
    next.set(parent.commentId, { ...state, expanded: true });
    floorStates.value = next;
    return;
  }
  // 首次展开 → 拉取
  const next = new Map(floorStates.value);
  next.set(parent.commentId, {
    replies: [],
    expanded: true,
    loading: true,
    hasMore: false,
    totalCount: 0,
    error: false,
    cursor: -1,
  });
  floorStates.value = next;
  try {
    const resp = await fetchFloorComments(props.songId, parent.commentId, {
      limit: 20,
      time: -1,
    });
    if (loadingSongId !== props.songId) return;
    const cur = floorStates.value.get(parent.commentId);
    if (!cur) return;
    const updated = new Map(floorStates.value);
    updated.set(parent.commentId, {
      ...cur,
      replies: resp.comments,
      loading: false,
      hasMore: resp.hasMore,
      totalCount: resp.totalCount,
      cursor: resp.hasMore ? (resp.comments[resp.comments.length - 1]?.time ?? -1) : -1,
    });
    floorStates.value = updated;
  } catch (err) {
    console.warn("[CommentPanel] floor load failed:", err);
    const cur = floorStates.value.get(parent.commentId);
    if (!cur) return;
    const updated = new Map(floorStates.value);
    updated.set(parent.commentId, { ...cur, loading: false, error: true });
    floorStates.value = updated;
    toast.error(t("comment.repliesFailed"));
  }
};

/** 加载更多楼层回复 */
const loadMoreFloor = async (parent: NeteaseComment): Promise<void> => {
  if (!props.songId) return;
  const cur = floorStates.value.get(parent.commentId);
  if (!cur || cur.loading || !cur.hasMore) return;
  const updated = new Map(floorStates.value);
  updated.set(parent.commentId, { ...cur, loading: true });
  floorStates.value = updated;
  try {
    const resp = await fetchFloorComments(props.songId, parent.commentId, {
      limit: 20,
      time: cur.cursor,
    });
    if (loadingSongId !== props.songId) return;
    const latest = floorStates.value.get(parent.commentId);
    if (!latest) return;
    const next = new Map(floorStates.value);
    next.set(parent.commentId, {
      ...latest,
      replies: [...latest.replies, ...resp.comments],
      loading: false,
      hasMore: resp.hasMore,
      cursor: resp.hasMore ? (resp.comments[resp.comments.length - 1]?.time ?? -1) : -1,
    });
    floorStates.value = next;
  } catch (err) {
    console.warn("[CommentPanel] floor load more failed:", err);
    const latest = floorStates.value.get(parent.commentId);
    if (!latest) return;
    const next = new Map(floorStates.value);
    next.set(parent.commentId, { ...latest, loading: false, error: true });
    floorStates.value = next;
    toast.error(t("comment.repliesFailed"));
  }
};

/** 强制触发 shallowRef 更新（修改内部字段后调用） */
const forceUpdateLists = (): void => {
  hotComments.value = [...hotComments.value];
  latestComments.value = [...latestComments.value];
};

/**
 * 点赞 / 取消点赞（乐观更新，失败回滚，防快速连点）
 * @param comment 评论对象
 */
const onLike = async (comment: NeteaseComment): Promise<void> => {
  if (!props.songId) return;
  // 评论点赞需要登录态（MUSIC_U），未登录时打开登录对话框
  if (!user.isLoggedIn) {
    toast.warning(t("comment.needLogin"));
    user.openLoginDialog();
    return;
  }
  // 防止快速连点：in-flight 期间忽略
  if (likingIds.has(comment.commentId)) return;
  likingIds.add(comment.commentId);
  const wasLiked = comment.liked;
  const wasCount = comment.likedCount;
  // 乐观更新：直接改对象 + 触发 shallowRef 更新
  comment.liked = !wasLiked;
  comment.likedCount = wasCount + (wasLiked ? -1 : 1);
  forceUpdateLists();
  try {
    await toggleCommentLike(props.songId, comment.commentId, !wasLiked);
  } catch (err) {
    // 回滚
    comment.liked = wasLiked;
    comment.likedCount = wasCount;
    forceUpdateLists();
    console.warn("[CommentPanel] like failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("301")) {
      toast.error(t("comment.loginExpired"));
      user.openLoginDialog();
    } else {
      toast.error(t("comment.likeFailed"));
    }
  } finally {
    likingIds.delete(comment.commentId);
  }
};

/**
 * 回复某条评论：把 `@昵称：原评论内容` 写入输入框并聚焦
 * @param comment 被回复的评论
 */
const replyTarget = ref<NeteaseComment | null>(null);

const onReply = (comment: NeteaseComment): void => {
  replyTarget.value = comment;
  const replyText = `回复 @${comment.user.nickname}：`;
  inputContent.value = replyText;
  void nextTick(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(".comment-panel textarea");
    if (textarea) {
      textarea.focus();
      // 光标定位到末尾，方便用户继续输入
      const len = textarea.value.length;
      textarea.setSelectionRange(len, len);
    }
  });
};

/** 清除 songId 的主进程 + 模块级缓存，确保下次拉到新数据 */
const invalidateCaches = (songId: string): void => {
  deleteCache(songId);
  // 主进程 comment_music 内存缓存（2 分钟 TTL）按接口名清空
  void window.api.apis.invalidateCache("netease", "comment_music");
};

/** 临时评论 ID 占位（负数，避免与真实 id 冲突） */
let tempCommentSeq = -1;

/**
 * 发送评论
 *
 * 乐观更新：发送后立即在列表顶部插入临时评论（commentId 用负数占位）；
 * API 成功后保留临时评论（commentId 仍为负数），清除缓存以便下次切歌回来时拉到真实数据；
 * 失败时移除临时评论并 toast 错误
 * - 未登录 → toast + 打开登录对话框
 * - 空内容 → toast 提示
 * - 业务码 405 / 250 / 404 → 针对性提示
 */
const onSend = async (): Promise<void> => {
  if (!props.songId) return;
  if (!user.isLoggedIn) {
    toast.warning(t("comment.needLogin"));
    user.openLoginDialog();
    return;
  }
  const content = inputContent.value.trim();
  if (!content) {
    toast.warning(t("comment.emptyContent"));
    return;
  }
  sending.value = true;
  // 临时评论插入顶部（仅当不是回复时；回复时插入到楼层里更合理，简化处理为也插顶部）
  const tempId = tempCommentSeq--;
  const tempComment: NeteaseComment = {
    commentId: tempId,
    content,
    time: Date.now(),
    likedCount: 0,
    liked: false,
    user: {
      userId: user.profile?.userId ?? 0,
      nickname: user.profile?.nickname ?? "",
      avatarUrl: user.profile?.avatarUrl ?? undefined,
    },
  };
  // 插入到最新评论顶部
  latestComments.value = [tempComment, ...latestComments.value];
  try {
    const replyId = replyTarget.value?.commentId;
    // 真实 replyId 不能是临时负数 id（用户可能给临时评论又点了回复；当前不展示临时评论的回复按钮）
    const realReplyId = replyId && replyId > 0 ? replyId : undefined;
    await sendSongComment(props.songId, content, realReplyId);
    inputContent.value = "";
    replyTarget.value = null;
    toast.success(t("comment.sent"));
    // 清除该 songId 的缓存，确保下次切歌回来时拉到包含新评论的数据
    // 不立即重新拉首屏：避免覆盖尚未完成的下一次发送的临时评论
    invalidateCaches(props.songId);
  } catch (err) {
    // 移除临时评论
    latestComments.value = latestComments.value.filter((c) => c.commentId !== tempId);
    if (err instanceof NeteaseCommentAddError) {
      if (err.code === 405) toast.error(t("comment.err405"));
      else if (err.code === 250) toast.error(t("comment.err250"));
      else if (err.code === 404) toast.error(t("comment.err404"));
      else if (err.code === 301) {
        toast.error(t("comment.loginExpired"));
        user.openLoginDialog();
      } else toast.error(t("comment.errFailed"));
    } else {
      console.warn("[CommentPanel] send failed:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("301")) {
        toast.error(t("comment.loginExpired"));
        user.openLoginDialog();
      } else {
        toast.error(t("comment.errFailed"));
      }
    }
  } finally {
    sending.value = false;
  }
};

/** 切歌时重新拉取 */
watch(
  () => props.songId,
  (id) => {
    if (!id) {
      hotComments.value = [];
      latestComments.value = [];
      total.value = 0;
      hasMore.value = false;
      moreHot.value = false;
      floorStates.value = new Map();
      return;
    }
    loadingSongId = id;
    floorStates.value = new Map();
    void loadFirst(id);
  },
  { immediate: true },
);

/** 列表变化时重新初始化高度数组并测量 */
watch(
  allComments,
  () => {
    initializeHeights();
    recalcVisibleRange();
    void nextTick(() => observeVisibleItems());
  },
  { flush: "post" },
);

/** 楼层展开变化时也需要重新测量 */
watch(floorStates, () => {
  void nextTick(() => {
    void nextTick(() => observeVisibleItems());
  });
});

onMounted(() => {
  // 首次挂载即创建 observer
  ensureObserver();
});

onBeforeUnmount(() => {
  if (scrollRafId !== null) {
    cancelAnimationFrame(scrollRafId);
    scrollRafId = null;
  }
  // 断开 observer 但保留高度缓存（模块级）
  resizeObserver?.disconnect();
  resizeObserver = null;
});

/** 把毫秒时间戳格式化为相对时间 / YYYY-MM-DD */
const formatTime = (ms: number): string => {
  if (!ms) return "";
  const now = Date.now();
  const diff = now - ms;
  const min = 60 * 1000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 设置项 ref（在 v-for 中收集 DOM） */
const setItemRef = (el: Element | null, index: number): void => {
  if (el) {
    itemRefs.value[index] = el as HTMLElement;
  }
};
</script>

<template>
  <div class="comment-panel flex flex-col h-full text-cover pr-20" style="--ce-auto-active: 0">
    <!-- 亚克力底框：surface-panel 半透明 + 封面色染色 + 强模糊饱和，颜色随封面与主题融合 -->
    <div
      class="flex flex-col h-full rounded-2xl border border-on-surface/10 overflow-hidden"
      :style="{
        backgroundColor: 'rgb(var(--s-surface-panel) / 0.48)',
        backgroundImage: 'linear-gradient(rgb(var(--s-cover) / 0.14), rgb(var(--s-cover) / 0.14))',
        backdropFilter: 'blur(28px) saturate(1.8) brightness(1.04)',
        WebkitBackdropFilter: 'blur(28px) saturate(1.8) brightness(1.04)',
        boxShadow:
          '0 20px 50px -12px rgba(0,0,0,0.35), inset 0 0 0 1px rgb(var(--s-on-surface) / 0.05)',
      }"
    >
      <!-- 头部 -->
      <div
        class="shrink-0 flex items-center justify-between gap-3 px-5 py-4 border-b border-on-surface/10"
      >
        <div class="flex flex-col min-w-0 flex-1">
          <h2 class="m-0 text-xl font-semibold leading-tight truncate">
            {{ t("comment.title") }}
          </h2>
          <span class="text-xs text-cover/60 mt-0.5">
            {{ t("comment.totalCount", { count: total }) }}
          </span>
        </div>
        <SButton
          type="cover"
          variant="secondary"
          round
          :size="36"
          class="shrink-0"
          @click="$emit('close')"
        >
          <template #icon><IconLucideX /></template>
        </SButton>
      </div>

      <!-- 列表 -->
      <div v-if="loading" class="flex-1 flex items-center justify-center text-cover/50">
        <IconLucideLoader2 class="size-6 animate-spin" />
      </div>
      <div
        v-else-if="loadError && allComments.length === 0"
        class="flex-1 flex flex-col items-center justify-center text-cover/45 gap-3"
      >
        <IconLucideMessageCircleOff class="size-10 opacity-50" />
        <div class="text-sm">{{ loadError }}</div>
        <SButton type="cover" variant="tertiary" size="small" @click="retryFirst">
          <template #icon><IconLucideRefreshCw /></template>
          {{ t("comment.retry") }}
        </SButton>
      </div>
      <div
        v-else-if="hotComments.length === 0 && latestComments.length === 0"
        class="flex-1 flex items-center justify-center text-cover/45"
      >
        <div class="text-center">
          <IconLucideMessageCircle class="size-10 mx-auto mb-2 opacity-50" />
          <div class="text-sm">{{ t("comment.empty") }}</div>
        </div>
      </div>
      <div
        v-else
        ref="scrollRef"
        class="flex-1 min-h-0 overflow-y-auto px-3 scroll-smooth"
        @scroll.passive="onScroll"
      >
        <!-- 虚拟滚动容器：用总高度撑开滚动条 -->
        <div :style="{ height: `${totalHeight}px`, position: 'relative' }">
          <!-- 可见区域偏移 -->
          <div ref="contentRef" :style="{ transform: `translateY(${offsetY}px)` }">
            <!-- 热评标题 -->
            <h3
              v-if="hotComments.length > 0 && visibleStart === 0"
              class="text-sm font-semibold uppercase tracking-wider text-cover/70 m-0 mb-3 px-2 pt-2"
            >
              {{ t("comment.hot") }}
            </h3>
            <!-- 最新评论标题（在热评后） -->
            <h3
              v-if="hotComments.length > 0 && visibleStart <= hotCount && visibleEnd > hotCount"
              class="text-sm font-semibold uppercase tracking-wider text-cover/70 m-0 mb-3 px-2 pt-2"
            >
              {{ t("comment.latest") }}
            </h3>
            <h3
              v-if="hotComments.length === 0 && visibleStart === 0 && latestComments.length > 0"
              class="text-sm font-semibold uppercase tracking-wider text-cover/70 m-0 mb-3 px-2 pt-2"
            >
              {{ t("comment.latest") }}
            </h3>
            <!-- 虚拟滚动可见项 -->
            <article
              v-for="item in visibleComments"
              :key="`${item.isHot ? 'h' : 'l'}-${item.comment.commentId}`"
              :ref="(el) => setItemRef(el as Element | null, item.index)"
              :data-index="item.index"
              class="flex gap-3 p-2.5 rounded-lg hover:bg-on-surface/5 transition-colors"
            >
              <SImg
                :src="item.comment.user.avatarUrl"
                class="size-9 rounded-full shrink-0 ring-1 ring-on-surface/15 object-cover"
                loading="lazy"
              />
              <div class="flex-1 min-w-0">
                <div class="text-xs font-medium text-cover/80 truncate">
                  {{ item.comment.user.nickname }}
                </div>
                <p
                  class="text-sm leading-relaxed m-0 mt-1 whitespace-pre-wrap break-words text-cover"
                >
                  {{ item.comment.content }}
                </p>
                <!-- 已有 beReplied（首屏返回的少量回复） -->
                <div
                  v-if="
                    item.comment.beReplied &&
                    item.comment.beReplied.length > 0 &&
                    !floorStates.get(item.comment.commentId)?.expanded
                  "
                  class="mt-1.5 text-xs text-cover/70 bg-on-surface/5 border-l-2 border-on-surface/25 rounded px-2 py-1.5"
                >
                  <div v-for="(r, i) in item.comment.beReplied" :key="i" class="break-words">
                    @{{ r.user.nickname }}：{{ r.content }}
                  </div>
                </div>
                <!-- 楼层展开后 inline 显示更多回复 -->
                <div
                  v-if="floorStates.get(item.comment.commentId)?.expanded"
                  class="mt-1.5 text-xs text-cover/70 bg-on-surface/5 border-l-2 border-on-surface/25 rounded px-2 py-1.5"
                >
                  <template v-if="floorStates.get(item.comment.commentId)?.loading">
                    <div class="flex items-center gap-1.5 text-cover/50">
                      <IconLucideLoader2 class="size-3 animate-spin" />
                      <span>{{ t("comment.loadingReplies") }}</span>
                    </div>
                  </template>
                  <template v-else>
                    <div
                      v-for="r in floorStates.get(item.comment.commentId)?.replies"
                      :key="r.commentId"
                      class="break-words"
                    >
                      @{{ r.user.nickname }}：{{ r.content }}
                    </div>
                    <button
                      v-if="floorStates.get(item.comment.commentId)?.hasMore"
                      type="button"
                      class="mt-1 text-cover/55 hover:text-cover transition-colors border-none bg-transparent p-0 cursor-pointer"
                      @click="loadMoreFloor(item.comment)"
                    >
                      {{ t("comment.loadMore") }}
                    </button>
                  </template>
                </div>
                <div class="flex items-center justify-between mt-1.5">
                  <div class="flex items-center gap-3">
                    <span class="text-xs text-cover/50">{{ formatTime(item.comment.time) }}</span>
                    <button
                      type="button"
                      class="text-xs text-cover/55 hover:text-cover transition-colors border-none bg-transparent p-0 cursor-pointer"
                      @click="onReply(item.comment)"
                    >
                      {{ t("comment.reply") }}
                    </button>
                    <!-- 展开 / 收起回复按钮：有 beReplied 或楼层已加载时显示 -->
                    <button
                      v-if="item.comment.beReplied && item.comment.beReplied.length > 0"
                      type="button"
                      class="text-xs text-cover/55 hover:text-cover transition-colors border-none bg-transparent p-0 cursor-pointer"
                      @click="toggleFloor(item.comment)"
                    >
                      {{
                        floorStates.get(item.comment.commentId)?.expanded
                          ? t("comment.collapseReplies")
                          : t("comment.expandReplies", { count: item.comment.beReplied.length })
                      }}
                    </button>
                  </div>
                  <button
                    type="button"
                    class="inline-flex items-center gap-1 text-xs transition-colors border-none bg-transparent p-0 cursor-pointer"
                    :class="item.comment.liked ? 'text-primary' : 'text-cover/55 hover:text-cover'"
                    @click="onLike(item.comment)"
                  >
                    <IconLucideThumbsUp
                      class="size-3.5"
                      :class="item.comment.liked ? 'fill-current' : ''"
                    />
                    <span class="tabular-nums">{{ item.comment.likedCount }}</span>
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>
        <!-- 加载更多热评按钮 -->
        <!-- position:relative + z-index:1 提升 stacking，避免虚拟滚动 contentRef 的 transform 创建堆叠上下文后绘制在按钮之上导致点击穿透 -->
        <div
          v-if="moreHot && !loadingMoreHot"
          class="flex justify-center py-3"
          style="position: relative; z-index: 1"
        >
          <SButton type="cover" variant="tertiary" size="small" @click="loadMoreHot">
            {{ t("comment.loadMoreHot") }}
          </SButton>
        </div>
        <div
          v-else-if="loadingMoreHot"
          class="flex justify-center py-3"
          style="position: relative; z-index: 1"
        >
          <IconLucideLoader2 class="size-5 animate-spin text-cover/50" />
        </div>
        <!-- 加载更多最新评论指示器 -->
        <div
          v-if="loadingMore"
          class="flex justify-center py-4"
          style="position: relative; z-index: 1"
        >
          <IconLucideLoader2 class="size-5 animate-spin text-cover/50" />
        </div>
        <div
          v-else-if="!hasMore && allComments.length > 0"
          class="flex justify-center py-4"
          style="position: relative; z-index: 1"
        >
          <span class="text-xs text-cover/45">{{ t("comment.noMore") }}</span>
        </div>
      </div>

      <!-- 底部输入 -->
      <div class="shrink-0 border-t border-on-surface/10">
        <!-- 回复目标预览条 -->
        <div v-if="replyTarget" class="flex items-center gap-2 px-5 pt-2 text-xs text-cover/60">
          <span class="truncate">
            回复 @{{ replyTarget.user.nickname }}：{{ replyTarget.content }}
          </span>
          <button
            type="button"
            class="shrink-0 text-cover/50 hover:text-cover transition-colors border-none bg-transparent p-0 cursor-pointer"
            @click="
              replyTarget = null;
              inputContent = '';
            "
          >
            ✕
          </button>
        </div>
        <div class="flex items-end gap-2 px-5 py-4">
          <SInput
            v-model="inputContent"
            type="textarea"
            :placeholder="t('comment.inputPlaceholder')"
            :rows="2"
            :disabled="sending"
            class="flex-1"
            @keydown.enter.exact.prevent="onSend"
          />
          <SButton
            type="cover"
            variant="secondary"
            :loading="sending"
            :disabled="!inputContent.trim()"
            @click="onSend"
          >
            {{ sending ? t("comment.sending") : t("comment.send") }}
          </SButton>
        </div>
      </div>
    </div>
  </div>
</template>
