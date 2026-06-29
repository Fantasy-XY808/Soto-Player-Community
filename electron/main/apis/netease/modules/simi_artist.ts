/**
 * 相似歌手
 *
 * params:
 * - artistid  歌手 id
 *
 * 响应：`{ code, artists: NeteaseArtist[], more }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const simiArtist: NeteaseModule = (query, request) => {
  const data = { artistid: query.artistid };
  return request("/api/discovery/simiArtist", data, createOption(query, "weapi"));
};

export default simiArtist;
