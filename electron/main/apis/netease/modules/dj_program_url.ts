/**
 * 电台节目播放地址
 *
 * 电台节目的 mainSong.id 走常规 song/url 接口常返回 null（节目 ID 不在歌曲库），
 * 需改用节目 id 调 dj/program/url 取播放地址。
 *
 * params:
 * - id   节目 id（program.id，非 mainSong.id）
 * - br   码率，默认 320000
 *
 * 响应：`{ code, data: { id, url, br, size, type, md5, ... } }`
 * - url == null：无版权 / 节目已被下架
 */

import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const dj_program_url: NeteaseModule = (query, request) => {
  const data = {
    id: query.id,
    br: query.br ?? 320_000,
  };
  return request("/api/dj/program/url", data, createOption(query, "weapi"));
};

export default dj_program_url;
