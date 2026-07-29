/**
 * Spotify 主进程服务
 *
 * 与 qqmusic / bilibili 风格一致：
 * - 2 分钟 LRU 响应缓存，空结果不缓存（避免一次失败被钉死）
 * - 统一入口 callSpotify(name, params)
 *
 * 模块见 modules/index.ts：
 * - search    /v1/search（应用级 token）
 * - song_url  /v1/tracks + /v1/me/tracks/contains
 *
 * 认证见 auth.ts：三种模式 + 自动 refresh + generation 作废旧请求
 */

import { createHash } from "node:crypto";
import { modules } from "./modules";
import type { SpotifyParams } from "./core/types";

/** 2 分钟响应缓存 */
const DEFAULT_TTL = 2 * 60 * 1000;
const MAX_ENTRIES = 200;

interface CacheEntry {
  value: unknown;
  expireAt: number;
}

const cache = new Map<string, CacheEntry>();

const hashParams = (params: unknown): string =>
  createHash("md5")
    .update(JSON.stringify(params ?? {}))
    .digest("hex")
    .slice(0, 8);

const cacheGet = (key: string): unknown => {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expireAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // LRU：访问后移到末尾
  cache.delete(key);
  cache.set(key, hit);
  return hit.value;
};

const cacheSet = (key: string, value: unknown, ttl = DEFAULT_TTL): void => {
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expireAt: Date.now() + ttl });
};

/** 清空 Spotify 内存缓存 */
export const clearSpotifyCache = (): void => {
  cache.clear();
};

/**
 * 判定 song_url 结果是否为"空"——避免一次失败被钉死 2 分钟
 *
 * - 401：未配置 client_id/secret 或 token 失效，不缓存
 * - 5xx：服务器错误，不缓存
 */
const isEmptyResult = (name: string, value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (name === "search") {
    // 空 keywords / 401 / 5xx 不缓存
    if (v.code === 400 || v.code === 401 || v.code === 500) return true;
  }
  if (name === "song_url") {
    if (v.code !== 200) return true;
  }
  return false;
};

/**
 * 调用任意 Spotify API
 * @param name    见 modules/index.ts（search / song_url）
 * @param params  业务参数；不想命中缓存可传 `timestamp: Date.now()`
 */
export const callSpotify = async (
  name: string,
  params: SpotifyParams = {},
): Promise<any> => {
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown spotify api: ${name}`);

  const key = `${name}|${hashParams(params)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const value = await fn(params);
  if (!isEmptyResult(name, value)) cacheSet(key, value);
  return value;
};
