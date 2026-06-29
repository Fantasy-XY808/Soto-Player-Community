/**
 * TTML 歌词缓存（来自 AMLL TTML DB）
 *
 * 表：lyric_ttml_cache(platform, id, content, fetched_at) PK (platform, id)
 *
 * - id：NCM 用 netease 数字 id；QM 用 mid
 * - content：TTML 文本，NULL 表示负缓存（DB 没有这首）
 * - 正缓存永久；负缓存 72h TTL（让新加入条目能被发现）
 */

import { getDb } from "./index";

/** 负缓存 72h TTL */
const NEGATIVE_TTL_MS = 72 * 60 * 60 * 1000;

export type Platform = "netease" | "qqmusic";

/**
 * 命中时返回 string（正缓存）或 null（负缓存）
 * 未命中或负缓存已过期返回 "miss"
 */
export const getCachedTTML = (platform: Platform, id: string): string | null | "miss" => {
  const row = getDb()
    .prepare("SELECT content, fetched_at FROM lyric_ttml_cache WHERE platform = ? AND id = ?")
    .get(platform, id) as { content: string | null; fetched_at: number } | undefined;
  if (!row) return "miss";
  if (row.content !== null) return row.content;
  // 负缓存：超过 TTL 视为 miss，让上层重抓
  if (Date.now() - row.fetched_at > NEGATIVE_TTL_MS) return "miss";
  return null;
};

/** upsert TTML；content 为 null 表示负缓存 */
export const setCachedTTML = (platform: Platform, id: string, content: string | null): void => {
  getDb()
    .prepare(
      `INSERT INTO lyric_ttml_cache (platform, id, content, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(platform, id) DO UPDATE SET
         content = excluded.content,
         fetched_at = excluded.fetched_at`,
    )
    .run(platform, id, content, Date.now());
};

/** 清空全部 TTML 缓存 */
export const clearLyricTtmlCache = (): void => {
  getDb().prepare("DELETE FROM lyric_ttml_cache").run();
};
