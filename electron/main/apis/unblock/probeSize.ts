/**
 * 解灰源 URL 文件大小 + 流参数探测（合并探测，不单独发 HEAD/GET）
 *
 * 用于 dispatcher 在多个解灰源都返回成功 URL 时，比较实际文件大小 + 真实位深/采样率，
 * 选最大的那个返回，避免被静默降级（如 GD 音乐台对 netease 源返回 16bit FLAC）。
 *
 * 探测实现：
 * - 不发独立 HEAD/GET-Content-Length：NAPI `probe_audio_meta` 内部 `HttpRangeSource::new`
 *   已发起 GET bytes=0-，从 206 Content-Range / 200 Content-Length 拿到 total_size 并暴露
 *   到 `JsProbeMeta.size`，单次 HTTP 同时拿 size + 真实流参数。
 * - 缓存探测结果（10min TTL，max 200 条），避免重复探测同一 URL。
 * - NAPI probeAudioMeta 调用 FFmpeg 读首帧 metadata，拿真实 sampleRate/bitsPerSample/codec
 * - 旧二进制未重建时 NAPI 函数不存在，降级为空 ProbeMeta（向后兼容）
 * - bitRate 优先用 NAPI 真值，NAPI 失败时调用方回落 size/duration 估算
 */

import { unblockLog } from "@main/utils/logger";
import { getPlayer } from "@main/services/engine";

/** NAPI 真探测超时（ms）：FFmpeg 打开 URL + 读首帧 */
const NAPI_PROBE_TIMEOUT_MS = 3_000;
/** 缓存 TTL（ms）：10 分钟 */
const PROBE_CACHE_TTL = 10 * 60 * 1_000;
/** 缓存容量上限 */
const PROBE_CACHE_CAPACITY = 200;

/** 探测结果：包含 size + 真实流参数 */
export interface ProbeMeta {
  /** 文件字节数；探测失败为 0 */
  size: number;
  /** 采样率（Hz），NAPI 不可用时为 0 */
  sampleRate: number;
  /** 位深（bits per sample），有损格式或 NAPI 不可用时为 0 */
  bitsPerSample: number;
  /** 比特率（bps），NAPI 真值优先，否则由 size/duration 估算 */
  bitRate: number;
  /** 声道数 */
  channels: number;
  /** 时长（秒），NAPI 不可用时为 0 */
  duration: number;
  /** 编码格式（如 "flac", "mp3", "aac"），未知为空串 */
  codec: string;
}

/** 缓存条目 */
interface CacheEntry {
  meta: ProbeMeta;
  expiresAt: number;
}

/** 探测结果缓存：URL → ProbeMeta */
const probeCache = new Map<string, CacheEntry>();

/**
 * 写入缓存，超容量时淘汰最旧的条目
 */
const setCache = (url: string, meta: ProbeMeta): void => {
  if (probeCache.size >= PROBE_CACHE_CAPACITY) {
    // 淘汰最旧条目（Map 按插入序，first() 即最旧）
    const oldest = probeCache.keys().next().value;
    if (oldest !== undefined) probeCache.delete(oldest);
  }
  probeCache.set(url, { meta, expiresAt: Date.now() + PROBE_CACHE_TTL });
};

/**
 * 读取缓存，过期返回 undefined 并清理
 */
const getCache = (url: string): ProbeMeta | undefined => {
  const entry = probeCache.get(url);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    probeCache.delete(url);
    return undefined;
  }
  return entry.meta;
};

/**
 * 探测 URL 指向的文件大小（字节数）
 *
 * 保留为 probeAudioMeta 的薄包装，向后兼容现有调用方。
 *
 * @param url 待探测的音频 URL
 * @returns 文件字节数；探测失败返回 0
 */
export const probeSize = async (url: string): Promise<number> => {
  const meta = await probeAudioMeta(url);
  return meta.size;
};

/**
 * 探测 URL 指向的音频流完整 metadata（单次 NAPI 同时拿 size + 流参数）
 *
 * 策略：
 * 1. 优先查缓存，命中直接返回
 * 2. NAPI probeAudioMeta 一次调用同时拿到 size（HttpRangeSource 内部已发起 GET
 *    bytes=0-，从 Content-Range / Content-Length 拿到 total_size）+ 真实流参数
 *    （sampleRate/bitsPerSample/codec 等），3s 超时
 *    - 旧二进制未重建时 NAPI 函数不存在，返回全 0 ProbeMeta（向后兼容）
 *    - NAPI 失败时所有字段为 0，调用方回落 size/duration 估算
 *
 * @param url 待探测的音频 URL
 * @returns ProbeMeta；探测失败的字段为 0
 */
export const probeAudioMeta = async (url: string): Promise<ProbeMeta> => {
  // 1. 命中缓存直接返回
  const cached = getCache(url);
  if (cached) return cached;

  // 2. 不发独立 HEAD/GET-Content-Length，NAPI probeAudioMeta 内部已从 Content-Range
  //    拿 total_size 并暴露到 JsProbeMeta.size
  const meta: ProbeMeta = {
    size: 0,
    sampleRate: 0,
    bitsPerSample: 0,
    bitRate: 0,
    channels: 0,
    duration: 0,
    codec: "",
  };
  try {
    const player = getPlayer();
    // prefetchAndProbe 内部构建 PrefetchedData 写入 prefetch_cache，
    // load 时 prefetch_cache.take(url) 命中，跳过第二次 FFmpeg 打开。
    // 旧二进制未重建时 prefetchAndProbe 不存在；feature-detection 避免运行时崩溃
    if (typeof player.prefetchAndProbe === "function") {
      const probed = await withTimeout(
        player.prefetchAndProbe(url),
        NAPI_PROBE_TIMEOUT_MS,
      );
      meta.size = probed.size;
      meta.sampleRate = probed.sampleRate;
      meta.bitsPerSample = probed.bitsPerSample;
      meta.bitRate = probed.bitRate;
      meta.channels = probed.channels;
      meta.duration = probed.duration;
      meta.codec = probed.codec;
    }
  } catch (err) {
    unblockLog.warn(
      `prefetchAndProbe NAPI 失败（size+流参数均降级为 0）: ${String(err).slice(0, 100)}`,
    );
  }

  // 3. 写入缓存（含失败结果，避免反复探测坏 URL）
  setCache(url, meta);
  if (meta.size === 0) {
    unblockLog.warn(`probeAudioMeta 未拿到 size: ${url.slice(0, 80)}...`);
  }
  return meta;
};

/**
 * 给 Promise 套一个超时（NAPI 异步调用可能因网络挂起）
 */
const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`probe timeout after ${ms}ms`)), ms),
    ),
  ]);
