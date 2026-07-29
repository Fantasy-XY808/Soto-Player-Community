/**
 * Bilibili 模块注册表
 */

import type { BiliModule } from "../core/types";

import lyric from "./lyric";
import search from "./search";
import song_url from "./song_url";

export const modules: Record<string, BiliModule> = {
  lyric,
  search,
  song_url,
};
