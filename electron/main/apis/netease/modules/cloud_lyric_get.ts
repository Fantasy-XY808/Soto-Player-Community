/**
 * 云盘歌词
 * params:
 * - uid  用户 id
 * - sid  云盘歌曲 id
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const cloud_lyric_get: NeteaseModule = (query, request) => {
  const data = {
    userId: query.uid,
    songId: query.sid,
    lv: -1,
    kv: -1,
  };
  return request("/api/cloud/lyric/get", data, createOption(query, "eapi"));
};

export default cloud_lyric_get;
