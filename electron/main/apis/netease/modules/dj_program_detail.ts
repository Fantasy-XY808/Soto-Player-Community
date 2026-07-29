/**
 * 电台节目详情
 *
 * params:
 * - id  节目 id
 *
 * 响应：`{ code, program: { id, name, coverUrl, duration, mainSong, description, radio, ... } }`
 */
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djProgramDetail: NeteaseModule = (query, request) => {
  const data = { id: query.id };
  return request("/api/dj/program/detail", data, createOption(query, "weapi"));
};

export default djProgramDetail;
