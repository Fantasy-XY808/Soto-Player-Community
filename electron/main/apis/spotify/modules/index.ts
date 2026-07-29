/**
 * Spotify 模块注册表
 *
 * 与 bilibili / qqmusic 一致的注册表风格：
 * - search    搜索（应用级 token）
 * - song_url  曲目详情 + 收藏状态（song.ts 实现，沿用 song_url 名以对齐其他音源）
 */

import type { SpotifyModule } from "../core/types";

import search from "../search";
import song_url from "../song";

export const modules: Record<string, SpotifyModule> = {
  search,
  song_url,
};
