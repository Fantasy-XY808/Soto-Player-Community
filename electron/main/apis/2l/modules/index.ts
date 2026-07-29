/**
 * 2L 模块注册表
 */

import type { TwoLModule } from "../core/types";

import lyric from "./lyric";
import search from "./search";
import song_url from "./song_url";

export const modules: Record<string, TwoLModule> = {
  lyric,
  search,
  song_url,
};
