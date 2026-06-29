/**
 * QM 模块注册表
 */

import type { QMModule } from "../core/types";

import hot_search from "./hot_search";
import leaderboard from "./leaderboard";
import lyric from "./lyric";
import match from "./match";
import search from "./search";
import song_info from "./song_info";
import song_list from "./song_list";
import song_url from "./song_url";

export const modules: Record<string, QMModule> = {
  hot_search,
  leaderboard,
  lyric,
  match,
  search,
  song_info,
  song_list,
  song_url,
};
