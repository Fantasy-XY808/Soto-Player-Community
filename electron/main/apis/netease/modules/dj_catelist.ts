/**
 * 电台分类列表
 *
 * 响应：`{ code, categories: [{ id, name, pic: { pcDefault, pcPortrait, web },
 *   picWeb, picPc, category, type, subcount, programCount, ... }] }`
 *
 * 用于"播客电台"主入口页顶部的分类网格
 */
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const djCatelist: NeteaseModule = (query, request) => {
  const data = {};
  return request("/api/djradio/category/get", data, createOption(query, "weapi"));
};

export default djCatelist;
