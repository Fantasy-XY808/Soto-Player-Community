/**
 * MusicFree 协议运行时缓存
 *
 * 职责：
 * 1. 维护 trackId → MusicFree 上下文（pluginId + musicItem）映射，跨切歌周期保留
 *    Track.mf 字段在播放器重建 Track 对象时可能丢失，此 Map 作为权威源
 * 2. URL 短期复用缓存（30 分钟）：同一 (pluginId, musicItem.id, quality) 在 TTL 内不重解析
 * 3. 预解析队列：播放器调用 prefetch(trackId) 提前 warm URL
 * 4. contextMap 持久化到 localStorage：进程重启后能恢复最近 N 首的 mf 上下文，
 *    让 MusicFree 队列曲目在重启后仍可续播（URL 重新解析，但无需重新搜索匹配）
 *
 * 不持久化 urlCache / prefetchCache：URL 有时效性（CDN 鉴权过期），
 * 重启后强制重新解析能保证 URL 有效性。
 */

import type { MfMusicItem, MfQualityKey } from "@shared/types/plugin";
import { LruCache } from "@/services/lruCache";

interface MfContext {
  pluginId: string;
  /** MusicFree 插件返回的 musicItem 原样保留，含 id/platform 与平台特有字段 */
  musicItem: MfMusicItem;
}

/** localStorage 持久化键名 */
const CONTEXT_STORAGE_KEY = "soto.musicfree.contextMap.v1";
/** 持久化条目上限：避免 localStorage 无限增长 */
const CONTEXT_STORAGE_MAX = 50;
/** 持久化写盘防抖：避免连续 setMfContext 频繁触发 JSON.stringify */
const PERSIST_DEBOUNCE_MS = 800;

/** trackId → MusicFree 上下文；同一 trackId 多次 search 会覆盖 */
const contextMap = new Map<string, MfContext>();

/** URL 短期复用：key = `${pluginId}:${musicItemId}:${quality}` */
const urlCache = new LruCache<string, { url: string; headers?: Record<string, string>; userAgent?: string; quality?: MfQualityKey }>({
  capacity: 100,
  ttl: 30 * 60 * 1000, // 30 分钟
});

/** 预解析结果缓存：trackId → 已 warm 的 URL（与 urlCache 区分：以 trackId 为键便于播放路径查询） */
const prefetchCache = new LruCache<string, string>({
  capacity: 30,
  ttl: 5 * 60 * 1000, // 5 分钟，避免预解析后切歌过晚导致 URL 过期
});

/** 防抖 timer 句柄 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 从 localStorage 加载持久化的 contextMap
 *
 * 启动时调用一次，把上次会话的 mf 上下文恢复到内存。
 * URL 与 prefetchCache 不恢复（有时效性，恢复后通常失效）。
 * 容错：JSON 解析失败或形状不对时静默丢弃，让运行时重新填充。
 */
const loadPersistedContexts = (): void => {
  try {
    const raw = localStorage.getItem(CONTEXT_STORAGE_KEY);
    if (!raw) return;
    const arr = JSON.parse(raw) as Array<[string, MfContext]>;
    if (!Array.isArray(arr)) return;
    for (const [id, ctx] of arr) {
      if (typeof id !== "string" || !ctx || typeof ctx !== "object") continue;
      if (typeof ctx.pluginId !== "string" || !ctx.musicItem) continue;
      contextMap.set(id, ctx);
    }
  } catch {
    // localStorage 不可用 / JSON 损坏：静默，下次 setMfContext 会重写
  }
};

/**
 * 把 contextMap 持久化到 localStorage（防抖）
 *
 * 仅保留最近 CONTEXT_STORAGE_MAX 条，按插入顺序淘汰。
 * 用 try/catch 包裹：localStorage 配额满时静默丢弃，不阻塞播放路径。
 */
const schedulePersist = (): void => {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const entries = Array.from(contextMap.entries());
      // 超出上限时按 FIFO 淘汰最早条目（entries 顺序与 Map 插入顺序一致）
      const trimmed = entries.slice(Math.max(0, entries.length - CONTEXT_STORAGE_MAX));
      localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
      // 配额满 / 序列化失败：静默，下次再试
    }
  }, PERSIST_DEBOUNCE_MS);
};

/** 启动时恢复持久化的 contextMap（IIFE 在模块加载时执行一次） */
loadPersistedContexts();

/** 写入 trackId 的 MusicFree 上下文 */
export const setMfContext = (trackId: string, ctx: MfContext): void => {
  contextMap.set(trackId, ctx);
  schedulePersist();
};

/** 读取 trackId 的 MusicFree 上下文；不存在返回 null */
export const getMfContext = (trackId: string): MfContext | null => {
  return contextMap.get(trackId) ?? null;
};

/** 清除指定 trackId 的上下文（卸载/换源时） */
export const clearMfContext = (trackId: string): void => {
  contextMap.delete(trackId);
  prefetchCache.delete(trackId);
  schedulePersist();
};

/** 生成 URL 缓存键 */
const urlCacheKey = (pluginId: string, musicItemId: string, quality: MfQualityKey): string =>
  `${pluginId}:${musicItemId}:${quality}`;

/** 从缓存读取已解析的 URL；未命中返回 null */
export const getCachedMfUrl = (
  pluginId: string,
  musicItemId: string,
  quality: MfQualityKey,
): { url: string; headers?: Record<string, string>; userAgent?: string; quality?: MfQualityKey } | null => {
  return urlCache.get(urlCacheKey(pluginId, musicItemId, quality)) ?? null;
};

/**
 * 写入 URL 缓存
 *
 * 接受 MfGetMediaSourceRes（url 可选），内部按 url 真值过滤；
 * 调用方传入 `res?.url` 已检过 truthy 也安全——双重保险避免缓存空 URL。
 */
export const setCachedMfUrl = (
  pluginId: string,
  musicItemId: string,
  quality: MfQualityKey,
  result: { url?: string; headers?: Record<string, string>; userAgent?: string; quality?: MfQualityKey },
): void => {
  if (!result.url) return;
  urlCache.set(urlCacheKey(pluginId, musicItemId, quality), {
    url: result.url,
    headers: result.headers,
    userAgent: result.userAgent,
    quality: result.quality,
  });
};

/** 写入预解析结果（以 trackId 为键，供播放路径直接命中） */
export const setPrefetchedUrl = (trackId: string, url: string): void => {
  if (url) prefetchCache.set(trackId, url);
};

/** 探测预解析 URL 是否存在（不消费，仅用于避免重复 warm） */
export const hasPrefetchedUrl = (trackId: string): boolean => prefetchCache.has(trackId);

/** 读取预解析 URL；命中后从缓存移除（一次性消费，避免 URL 过期后仍被复用） */
export const consumePrefetchedUrl = (trackId: string): string | null => {
  const url = prefetchCache.get(trackId);
  if (url) prefetchCache.delete(trackId);
  return url ?? null;
};

/**
 * MusicFree 音质档位降级序列
 *
 * 从低到高排列：low → standard → high → super。
 * mfQualityFallbackChain 会从此序列派生「从最高档向下逐档尝试」的探测链，
 * 保证拿到的是当前插件能提供的最高音质，而非目标档位以下的中等档位。
 */
export const MF_QUALITY_LADDER: MfQualityKey[] = ["low", "standard", "high", "super"];

/**
 * 计算从期望档位起向上的「优先尝试最高档」序列
 *
 * 目标 high 时：MF 插件通常能提供至少 high（320k）；
 * 但若 super（无损）也可用，应优先返回 super。
 * 因此本函数返回 [super, high] —— 先尝试最高，失败再回退到期望档位。
 *
 * 目标 super 时仅尝试 super（已是最高）；
 * 目标 standard 时尝试 super → high → standard；
 * 目标 low 时尝试 super → high → standard → low。
 *
 * 这种「最高优先」策略对齐 MusicFreeDesktop 的实际行为：
 * 插件 getMediaSource 内部会按 quality 参数选最高可用源，
 * 宿主再叠加一层「先问 super 再降级」可让普通用户也享受无损。
 *
 * @param desired - 目标档位（作为降级下限）
 * @returns 从最高档起、逐档向下到 desired 的尝试序列
 */
export const mfQualityFallbackChain = (desired: MfQualityKey): MfQualityKey[] => {
  const start = MF_QUALITY_LADDER.indexOf(desired);
  if (start < 0) return ["super", "high"];
  // slice(start) = [desired, ...higher]；reverse 后 = [...higher, desired]
  // 例：desired=high → slice = [high, super] → reverse = [super, high]
  return MF_QUALITY_LADDER.slice(start).reverse();
};
