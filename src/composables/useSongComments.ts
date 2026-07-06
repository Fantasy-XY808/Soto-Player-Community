/**
 * 纯音乐热评展示
 *
 * 切歌时拉热评；对所有音源生效（仅网易云有评论 API，其他源拉不到则保持 null）；
 * LRU 缓存最近 100 首的「选中那一条」
 */

import { computed, shallowRef, watch } from "vue";
import { useMediaStore } from "@/stores/media";
import { fetchSongComments, type NeteaseComment } from "@/apis/comment/netease";
import { isPureMusic } from "@shared/utils/pureMusicDetect";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";
import { LruCache } from "@/services/lruCache";

/** 评论加载状态 */
export type CommentLoadStatus = "idle" | "loading" | "loaded" | "failed" | "unsupported";

/** 当前展示的热评（只缓存选中那一条，避免 TrackDetail 体量数据驻留） */
export interface SelectedComment {
  commentId: number;
  content: string;
  nickname: string;
  songTitle: string;
}

/** LRU 缓存上限 */
const CACHE_MAX = 100;

/** songId → 选中热评；get 命中会重排，set 超容量自动淘汰最久未访问 */
const cache = new LruCache<string, SelectedComment>({ capacity: CACHE_MAX });

/** 当前展示的热评 */
const activeComment = shallowRef<SelectedComment | null>(null);

/** 当前评论加载状态 */
const loadStatus = shallowRef<CommentLoadStatus>("idle");

/** 进行中的拉取任务，用于切歌时取消旧任务（防止竞态覆盖） */
let loadingToken = 0;

/** 失败 toast 冷却时间戳，避免切歌频繁弹窗 */
let lastFailToastAt = 0;
/** 冷却时长：30 秒 */
const FAIL_TOAST_COOLDOWN_MS = 30_000;

/** 从热评列表中随机挑一条 */
const pickHotComment = (hots: NeteaseComment[]): NeteaseComment | null => {
  if (hots.length === 0) return null;
  const idx = Math.floor(Math.random() * hots.length);
  return hots[idx] ?? null;
};

/**
 * 从评论列表中挑一条内容充实的评论
 * 优先挑选内容长度 ≥ 8 的评论，避免挑到"沙发""前排"之类无意义短评
 */
const pickFromComments = (comments: NeteaseComment[]): NeteaseComment | null => {
  if (comments.length === 0) return null;
  const candidates = comments.filter((c) => c.content && c.content.length >= 8);
  const pool = candidates.length > 0 ? candidates : comments;
  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx] ?? null;
};

/**
 * 拉取并挑选一条热评
 * 仅网易云源有评论 API；其他源直接返回 null（保持纯音乐 fallback 文案）
 * @param songId 网易云歌曲 id
 * @param songTitle 歌曲标题（用于出处行展示）
 * @param token 本轮拉取的 token；过期则忽略结果
 */
const loadComment = async (songId: string, songTitle: string, token: number): Promise<void> => {
  const cached = cache.get(songId);
  if (cached) {
    activeComment.value = cached;
    loadStatus.value = "loaded";
    return;
  }
  loadStatus.value = "loading";
  try {
    const resp = await fetchSongComments(songId, { limit: 20 });
    if (token !== loadingToken) return;
    // 优先热评；热评为空时回退到最新评论（纯音乐评论总量低，热评常为空）
    const picked = pickHotComment(resp.hotComments) ?? pickFromComments(resp.comments);
    if (!picked) {
      activeComment.value = null;
      loadStatus.value = "loaded";
      return;
    }
    const selected: SelectedComment = {
      commentId: picked.commentId,
      content: picked.content,
      nickname: picked.user.nickname,
      songTitle,
    };
    cache.set(songId, selected);
    activeComment.value = selected;
    loadStatus.value = "loaded";
  } catch (err) {
    console.warn("[useSongComments] load failed:", err);
    if (token === loadingToken) {
      activeComment.value = null;
      loadStatus.value = "failed";
      // 冷却期内不重复弹 toast，避免切歌频繁打扰
      const now = Date.now();
      if (now - lastFailToastAt > FAIL_TOAST_COOLDOWN_MS) {
        lastFailToastAt = now;
        toast.warning(i18n.global.t("comment.hotLoadFailed"));
      }
    }
  }
};

/** 清空缓存（登出 / 调试场景） */
export const clearCommentCache = (): void => {
  cache.clear();
  activeComment.value = null;
  loadStatus.value = "idle";
};

/**
 * 纯音乐热评 composable
 *
 * 监听 media.track?.id 与 parsedLyric：
 * - 所有音源都判定纯音乐（isPureMusicTrack 不再限定 source）
 * - 仅网易云源拉热评（其他源无评论 API，activeComment 保持 null，UI 走 fallback 文案）
 * - 歌词加载中或非纯音乐时清空 activeComment
 * - 切歌或切源时旧任务作废，避免覆盖
 */
export const useSongComments = () => {
  const media = useMediaStore();

  /** 当前歌曲是否为纯音乐（仅在歌词加载完成后判定；不限音源） */
  const isPureMusicTrack = computed(() => {
    if (media.lyricLoading) return false;
    return isPureMusic(media.parsedLyric);
  });

  /** 手动重试：失败后用户可直接重试，不必切歌 */
  const retry = (): void => {
    const id = media.track?.id;
    const source = media.track?.source;
    if (!id || source !== "netease") return;
    if (!isPureMusic(media.parsedLyric)) return;
    const token = ++loadingToken;
    void loadComment(String(id), media.track?.title ?? "", token);
  };

  watch(
    () => [media.track?.id, media.track?.source, media.parsedLyric, media.lyricLoading] as const,
    ([id, source, lyrics, loading]) => {
      const token = ++loadingToken;
      if (!id || loading) {
        activeComment.value = null;
        loadStatus.value = "idle";
        return;
      }
      if (!isPureMusic(lyrics)) {
        activeComment.value = null;
        loadStatus.value = "idle";
        return;
      }
      // 仅网易云有评论 API；其他源标记 unsupported，UI 走对应 fallback 文案
      if (source !== "netease") {
        activeComment.value = null;
        loadStatus.value = "unsupported";
        return;
      }
      void loadComment(String(id), media.track?.title ?? "", token);
    },
    { immediate: true },
  );

  return { activeComment, isPureMusicTrack, loadStatus, retry };
};
