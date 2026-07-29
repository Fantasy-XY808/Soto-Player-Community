/**
 * 用户订阅的电台列表
 *
 * 响应：`{ code, djRadios: [{ id, name, dj, picUrl, category, subCount, programCount, ... }] }`
 *
 * 用于"我订阅的电台"页面
 */
import { createOption } from "../core/option";
import type { NeteaseModule } from "../core/types";

const userDj: NeteaseModule = (query, request) => {
  const data = {};
  return request("/api/user/dj", data, createOption(query, "weapi"));
};

export default userDj;
