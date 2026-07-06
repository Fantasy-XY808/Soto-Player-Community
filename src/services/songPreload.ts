/**
 * 下一首预加载服务
 *
 * 在当前歌曲播放过程中，提前为下一首歌曲做准备：
 *   1. 预解析下一首歌曲的 URL（节省切歌时 200ms~2s 的网络往返）
 *   2. 触发磁盘缓存预下载（命中后切歌时直接走本地缓存，零网络）
 *
 * 预加载策略：
 *   - 播放进度超过 30% 时触发首次预解析
 *   - 播放进度超过 60% 时若仍未完成预下载，主动触发磁盘缓存下载
 *   - URL 缓存上限 1 首（当前 + 下一首），切歌时清理
 *   - 预下载在后台异步进行，不阻塞播放
 */

import type { Track } from "@shared/types/player";
import { resolveTrackSource } from "@/services/audioSource";
import { useStatusStore } from "@/stores/status";
import * as queue from "@/stores/queue";

/** 首次预解析触发阈值（播放进度百分比） */
const TRIGGER_PROGRESS = 0.3;
/** 二次磁盘缓存预下载触发阈值（播放进度百分比） */
const PREFETCH_PROGRESS = 0.6;

/** 预加载缓存：trackId → resolved source */
let preloadedTrackId: string | null = null;
let preloadedSource: string | null = null;
/** 预加载阶段触发的磁盘缓存下载回调（如果有） */
let preloadedCacheRequest: (() => Promise<void>) | null = null;

/** 预加载中标记，避免重复请求 */
let preloading = false;
/** 磁盘缓存预下载是否已触发 */
let prefetchTriggered = false;

/**
 * 尝试预加载下一首歌曲
 * 在播放进度达到阈值时由 position 事件调用
 * @param positionMs 当前播放位置
 * @param durationMs 当前歌曲时长
 */
export const tryPreloadNext = (positionMs: number, durationMs: number): void => {
  if (durationMs <= 0) return;
  const progress = positionMs / durationMs;
  if (progress < TRIGGER_PROGRESS) return;
  void preloadNext();
  // 二次触发磁盘缓存预下载
  if (progress >= PREFETCH_PROGRESS && !prefetchTriggered && preloadedCacheRequest) {
    prefetchTriggered = true;
    void preloadedCacheRequest().catch(() => {
      // 预下载失败静默，切歌时会重新解析
    });
  }
};

/**
 * 预加载下一首歌曲
 * 解析队列中下一首歌曲的 URL 并缓存
 */
export const preloadNext = async (): Promise<void> => {
  if (preloading) return;

  const nextTrack = getNextTrack();
  if (!nextTrack) return;

  // 已经预加载过同一首
  if (preloadedTrackId === nextTrack.id) return;

  preloading = true;
  try {
    const resolved = await resolveTrackSource(nextTrack);
    if (resolved) {
      preloadedTrackId = nextTrack.id;
      preloadedSource = resolved.source;
      preloadedCacheRequest = resolved.cacheRequest ?? null;
      prefetchTriggered = false;
    }
  } catch {
    // 预加载失败静默，切歌时会重新解析
  } finally {
    preloading = false;
  }
};

/**
 * 获取队列中的下一首歌曲
 */
const getNextTrack = (): Track | null => {
  const status = useStatusStore();
  const q = queue.queue.value;
  if (q.length === 0) return null;
  const nextIdx = status.playIndex + 1;
  if (nextIdx >= q.length) return null;
  return q[nextIdx] ?? null;
};

/**
 * 消费预加载的 URL
 * 切歌时调用，命中则返回预解析的 URL
 * @param trackId 要加载的 track id
 * @returns 预解析的 URL 或 null
 */
export const consumePreloaded = (trackId: string): string | null => {
  if (preloadedTrackId === trackId && preloadedSource) {
    const source = preloadedSource;
    preloadedTrackId = null;
    preloadedSource = null;
    preloadedCacheRequest = null;
    prefetchTriggered = false;
    return source;
  }
  return null;
};

/**
 * 清除预加载缓存
 * 切歌或队列变化时调用
 */
export const clearPreload = (): void => {
  preloadedTrackId = null;
  preloadedSource = null;
  preloadedCacheRequest = null;
  prefetchTriggered = false;
};
