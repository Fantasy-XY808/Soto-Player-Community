/**
 * 相似歌单
 *
 * params:
 * - playlistid  歌单 id
 * - limit       返回数量，默认 50
 * - offset      偏移
 *
 * 响应：`{ code, playlists: NeteasePlaylist[], more }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const simiPlaylist: NeteaseModule = (query, request) => {
  const data = {
    playlistid: query.playlistid,
    limit: query.limit ?? 50,
    offset: query.offset ?? 0,
  };
  return request("/api/discovery/simiPlaylist", data, createOption(query, "weapi"));
};

export default simiPlaylist;
