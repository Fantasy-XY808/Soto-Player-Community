/**
 * Automix 分析缓存与按需分析封装
 *
 * - 以 track.id（本地用 path 兜底）为 key 缓存分析结果，避免重复解码
 * - 提供 ensureAnalysis(track) 接口：缓存命中直接返回，未命中调 IPC 分析
 * - LRU 风格淘汰：超过上限时删除最早写入的项
 */

import type { Track } from "@shared/types/player";
import type { AudioAnalysisResult } from "@shared/types/audioAnalysis";
import { ensureLocalCachePath } from "@/services/audioSource";

/** 缓存条目 */
export interface CacheEntry {
  /** 分析结果（null 表示分析失败已记录，避免反复重试） */
  result: AudioAnalysisResult | null;
  /** 写入时间戳（用于 LRU） */
  ts: number;
}

/** 缓存上限（按 AGENTS.md "in-memory caches must be bounded" 规则） */
const CACHE_MAX = 200;

/** 分析中标记（避免同一首并发重复分析） */
const inflight = new Map<string, Promise<AudioAnalysisResult | null>>();

/** LRU 缓存 */
const cache = new Map<string, CacheEntry>();

/**
 * 取曲目的稳定标识（优先 track.id；本地文件无 id 时用 path）
 * @param track - 曲目
 * @returns 缓存 key；无法生成时返回 null
 */
export const trackKey = (track: Track): string | null => {
  if (track.id) return track.id;
  if (track.path) return `path:${track.path}`;
  return null;
};

/**
 * 取需要分析的源路径（同步版本，仅返回本地 path）
 * - 流媒体 / 在线源需异步缓存到本地，由 ensureAnalysis 内部调 ensureLocalCachePath
 * @returns 本地 path；非本地源返回 null
 */
export const trackSource = (track: Track): string | null => {
  if (track.path) return track.path;
  return null;
};

/** 触发 LRU 淘汰 */
const evictIfNeeded = (): void => {
  while (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

/**
 * 同步读取缓存
 * @param key - 缓存 key
 */
export const getCached = (key: string): AudioAnalysisResult | null | undefined => {
  const entry = cache.get(key);
  if (!entry) return undefined;
  // LRU：删后重插，使其成为最新
  cache.delete(key);
  cache.set(key, entry);
  return entry.result;
};

/**
 * 写入缓存
 * @param key - 缓存 key
 * @param result - 分析结果（null 表示失败）
 */
export const setCached = (key: string, result: AudioAnalysisResult | null): void => {
  evictIfNeeded();
  cache.set(key, { result, ts: Date.now() });
};

/**
 * 清空缓存（设置页/调试用）
 */
export const clearAnalysisCache = (): void => {
  cache.clear();
  inflight.clear();
};

/**
 * 取缓存快照（只读视图，UI 展示用）
 */
export const getCacheSnapshot = (): ReadonlyMap<string, CacheEntry> => cache;

/**
 * 确保曲目已分析：缓存命中直接返回，否则调 IPC 分析并写回缓存
 * - 本地曲：直接用 track.path 喂给分析器
 * - 流媒体 / 在线曲：先 ensureLocalCachePath 缓存到本地，再走本地分析流程
 * @param track - 待分析曲目
 * @returns 分析结果；曲目无可分析源时返回 null
 */
export const ensureAnalysis = async (track: Track): Promise<AudioAnalysisResult | null> => {
  const key = trackKey(track);
  if (!key) return null;

  const cached = getCached(key);
  if (cached !== undefined) return cached;

  // 合并并发请求
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<AudioAnalysisResult | null> => {
    try {
      // 本地 path 优先；流媒体 / 在线源异步缓存到本地
      let source = trackSource(track);
      if (!source) {
        source = await ensureLocalCachePath(track);
      }
      if (!source) {
        setCached(key, null);
        return null;
      }
      const res = await window.api.audioAnalysis.analyze(source);
      if (res.success) {
        setCached(key, res.data);
        return res.data;
      }
      // 失败：写 null 防止反复重试（用户切回此曲时再手动触发）
      setCached(key, null);
      return null;
    } catch {
      setCached(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
};

/**
 * 批量预分析：按队列顺序串行调用 IPC，避免主进程 spawn_blocking 同时占用多个内核
 * @param tracks - 待分析曲目列表
 * @param onProgress - 单首完成回调（用于 UI 进度展示）
 */
export const prefetchAnalysis = async (
  tracks: Track[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> => {
  const total = tracks.length;
  let done = 0;
  for (const track of tracks) {
    await ensureAnalysis(track);
    done += 1;
    onProgress?.(done, total);
  }
};
