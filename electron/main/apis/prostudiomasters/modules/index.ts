/**
 * ProStudioMasters 模块注册表
 */

import type { PsmModule } from "../core/types";

import lyric from "./lyric";
import search from "./search";
import song_url from "./song_url";

export const modules: Record<string, PsmModule> = {
  lyric,
  search,
  song_url,
};
