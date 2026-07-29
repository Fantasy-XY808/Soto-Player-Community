/**
 * mora 模块注册表
 */

import type { MoraModule } from "../core/types";

import lyric from "./lyric";
import search from "./search";
import song_url from "./song_url";

export const modules: Record<string, MoraModule> = {
  lyric,
  search,
  song_url,
};
