/**
 * Tidal 主进程服务
 *
 * 与 Qobuz 之不同：
 * - 鉴权用 OAuth 2.0 + PKCE（access_token + refresh_token），不是 user_auth_token
 * - 海外 API 必须用 overseasFetch 走代理（与 Qobuz 一致）
 * - access_token 1 小时过期，需自动刷新（剩余 < 5 分钟时触发）
 * - manifest 是 base64 编码的 JSON，需解码后取 url 字段
 *
 * 统一入口：callTidal(name, params)
 */

import { createHash } from "node:crypto";
import { modules } from "./modules";
import type { TidalParams } from "./core/types";

/** 2 分钟响应缓存（与 Qobuz 一致） */
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
  // LRU：访问后移到末尾（最新位置）
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

export const clearTidalCache = (): void => {
  cache.clear();
};

/**
 * 调用任意 Tidal API
 * @param name    见 modules/index.ts（search / song_url / lyric）
 * @param params  业务参数；不想命中缓存可传 `timestamp: Date.now()`
 */
export const callTidal = async (name: string, params: TidalParams = {}): Promise<any> => {
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown tidal api: ${name}`);

  const key = `${name}|${hashParams(params)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;

  const value = await fn(params);
  // 空结果不缓存：避免一次失败被钉死 2 分钟，无法立即回落其他音源
  if (!isEmptyResult(value)) cacheSet(key, value);
  return value;
};

/**
 * 空结果判定
 * - search: songs 数组为空
 * - song_url: url 为空字符串 / null / undefined
 * - lyric: code 非 200
 */
const isEmptyResult = (value: unknown): boolean => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (Array.isArray(v.songs) && v.songs.length === 0) return true;
  if (v.code === 200 && (v.url === "" || v.url === null || v.url === undefined)) return true;
  if (typeof v.code === "number" && v.code !== 200) return true;
  return false;
};
