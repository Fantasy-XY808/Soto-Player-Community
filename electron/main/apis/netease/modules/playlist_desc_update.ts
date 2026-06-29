/**
 * 更新歌单描述
 *
 * params:
 * - id    歌单 id
 * - desc  新描述（空字符串清空）
 *
 * 响应：`{ code }`
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const playlistDescUpdate: NeteaseModule = (query, request) => {
  const data = { id: query.id, desc: query.desc ?? "" };
  return request("/api/playlist/desc/update", data, createOption(query, "eapi"));
};

export default playlistDescUpdate;
