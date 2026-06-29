/**
 * 外部 API 门禁中间件
 * - externalApi.enabled   总开关：关闭时 /api/* 与 /ws 全部 403
 * - externalApi.wsEnabled 子开关：关闭时 /ws 单独 403，REST 不受影响
 */

import type { MiddlewareHandler } from "hono";
import { store } from "@main/store";

/** 总开关 */
export const externalControlGate: MiddlewareHandler = async (c, next) => {
  if (!store.get("externalApi.enabled")) {
    return c.json({ error: "external API disabled" }, 403);
  }
  await next();
  return;
};

/** WS 子开关 */
export const wsGate: MiddlewareHandler = async (c, next) => {
  if (!store.get("externalApi.wsEnabled")) {
    return c.json({ error: "WebSocket disabled" }, 403);
  }
  await next();
  return;
};
