/**
 * Netease API 主进程服务
 *
 * 直接在 Node 侧实现加解密 + HTTP 调用，不再依赖任何网易云服务端 npm 包。
 * 加密算法等核心逻辑移植自 @neteasecloudmusicapienhanced/api（见 core/crypto.ts）。
 *
 * 统一入口 `callNetease(name, params)`：
 *   1) 从 sessions 表加载 cookies 注入（内存缓存，不重复读 SQLite）
 *   2) 走一层内存响应缓存（2 分钟，对齐原包 apicache 行为）
 *   3) 路由到 modules/<name>
 *   4) 只在登录相关接口上把响应 set-cookie 写回 sessions；其它接口不落库
 */

import {
  clearSessionCookies,
  getSessionCookies,
  saveSessionCookies,
} from "@main/database/sessions";
import { store } from "@main/store";
import { coreLog } from "@main/utils/logger";
import { buildCacheKey, cacheClear, cacheGet, cacheSet } from "./core/cache";
import { cookieToJson } from "./core/cookie";
import { getAnonymousToken } from "./core/device";
import { createRequest } from "./core/request";
import { modules } from "./modules";
import type { Query } from "./core/option";

/** 会变更登录态的接口：响应里若带 set-cookie，才值得写回 SQLite */
const SESSION_MUTATING: ReadonlySet<string> = new Set([
  "login",
  "login_cellphone",
  "login_qr_check",
  "login_refresh",
  "logout",
  "register_anonimous",
]);

/** 不采用缓存的实时接口 */
const NON_CACHEABLE: ReadonlySet<string> = new Set([
  "song_url",
  "song_download_url",
  "scrobble",
  "scrobble_v1",
  "like",
  "playlist_create",
  "playlist_delete",
  "playlist_tracks",
  "playlist_subscribe",
  "playlist_name_update",
  "playlist_desc_update",
  "playlist_order_update",
  "playlist_detail",
  "user_playlist",
  "user_subcount",
  "user_cloud",
  "user_cloud_del",
  "cloud_upload_check",
  "cloud_nos_token",
  "cloud_upload_info",
  "cloud_pub",
  "cloud_upload_check_v2",
  "cloud_song_import",
  "album_sub",
  "playmode_intelligence",
  "personal_fm",
  "fm_trash",
  "recommend_songs",
  "comment_like",
  "comment_add",
  "comment_delete",
  "event",
  "mv_url",
  "dj_detail",
]);

/** 国内 IP 前缀池 */
const CN_IP_PREFIXES = [
  "116.25",
  "121.8",
  "120.36",
  "39.144",
  "117.136",
  "223.104",
  "171.8",
  "182.140",
];

/** 本会话的国内 IP */
let cachedRealIp = "";
const sessionRealIp = (): string => {
  if (!cachedRealIp) {
    const prefix = CN_IP_PREFIXES[Math.floor(Math.random() * CN_IP_PREFIXES.length)];
    const third = Math.floor(Math.random() * 256);
    const fourth = 1 + Math.floor(Math.random() * 254);
    cachedRealIp = `${prefix}.${third}.${fourth}`;
  }
  return cachedRealIp;
};

/** 内存缓存 */
let sessionCache: Record<string, string> | null = null;

const loadSession = (): Record<string, string> => {
  if (!sessionCache) sessionCache = getSessionCookies("netease");
  return sessionCache;
};

const persistSession = (cookies: Record<string, string>): void => {
  sessionCache = cookies;
  saveSessionCookies("netease", cookies);
};

/** "k1=v1; k2=v2; ..." 形式序列化 */
const serialize = (cookies: Record<string, string>): string =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

export const getNeteaseCookies = (): Record<string, string> => ({ ...loadSession() });

export const setNeteaseCookies = (cookies: Record<string, string>): void => {
  persistSession(cookies);
  cacheClear();
};

export const mergeNeteaseCookies = (patch: Record<string, string>): void => {
  persistSession({ ...loadSession(), ...patch });
  cacheClear();
};

export const clearNeteaseCookies = (): void => {
  sessionCache = {};
  clearSessionCookies("netease");
  cacheClear();
};

/**
 * 匿名态注册的进程级 Promise：避免并发请求重复触发 register_anonimous
 *
 * - 未登录态下，weapi 接口（如 comment_music）需要 MUSIC_A 才能通过鉴权
 * - register_anonimous 模块成功后会把 token 写入 device.ts；这里只缓存「注册中」状态
 */
let anonymousRegisterPromise: Promise<void> | null = null;

/** 匿名注册失败冷却：网易云风控严格时避免每次请求都触发失败注册 */
let anonymousRegisterCooldownUntil = 0;

/** 匿名注册失败冷却时长：30 秒内不再重试
 * 原 5 分钟过长——未登录用户重启应用或网络恢复后，仍要等 5 分钟才能重试匿名注册，
 * 期间 comment_music 等 weapi 接口持续 301 失败，评论列表/纯音乐热评全部拉不到
 */
const ANONYMOUS_REGISTER_COOLDOWN_MS = 30 * 1000;

/**
 * 确保匿名 token 已就绪；未登录且未注册时触发一次 register_anonimous
 *
 * @param session 当前会话 cookie（用于判断是否已登录）
 */
const ensureAnonymousToken = async (session: Record<string, string>): Promise<void> => {
  if (session.MUSIC_U) return;
  if (getAnonymousToken()) return;
  // 不信任 session.MUSIC_A：持久化的 MUSIC_A 跨重启后可能已被服务端失效，
  // 信任它会直接 short-circuit 导致 comment_music 等 weapi 接口持续 301。
  // 改由 processCookieObject 在请求时注入内存中的 anonymousToken（若已注册）；
  // 没有就触发注册流程
  // 失败冷却期内跳过注册，让业务接口按既有逻辑报错（避免无意义重复请求）
  if (Date.now() < anonymousRegisterCooldownUntil) return;
  if (!anonymousRegisterPromise) {
    anonymousRegisterPromise = (async () => {
      try {
        await callNetease("register_anonimous", {});
        // 注册返回但没拿到 token（风控期 code:200 无 token 字段）→ 进冷却，避免死循环
        if (!getAnonymousToken()) {
          coreLog.warn("[netease] register_anonimous returned 200 but no token");
          anonymousRegisterCooldownUntil = Date.now() + ANONYMOUS_REGISTER_COOLDOWN_MS;
        }
      } catch (err) {
        // 失败不阻塞后续业务调用；让原始接口按既有逻辑报错
        coreLog.warn("[netease] register_anonimous failed:", err);
        // 进入冷却期，避免网易云风控场景下持续触发
        anonymousRegisterCooldownUntil = Date.now() + ANONYMOUS_REGISTER_COOLDOWN_MS;
      } finally {
        anonymousRegisterPromise = null;
      }
    })();
  }
  await anonymousRegisterPromise;
};

/** set-cookie 数组 → 扁平对象（只取 key=value，忽略 Path/Domain/Max-Age 等属性） */
const parseSetCookie = (arr: string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const raw of arr) {
    const first = raw.split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const key = first.slice(0, eq).trim();
    const val = first.slice(eq + 1).trim();
    if (key) out[key] = val;
  }
  return out;
};

/**
 * 调用任意 Netease API
 * @param name 见 modules/index.ts 中的 key
 * @param params 业务参数；cookie 自动注入，无需调用方传
 */
export const callNetease = async (
  name: string,
  params: Record<string, unknown> = {},
): Promise<{ status: number; body: any }> => {
  // hasOwn 守卫
  const fn = Object.hasOwn(modules, name) ? modules[name] : undefined;
  if (!fn) throw new Error(`unknown netease api: ${name}`);

  const session = loadSession();

  // 读缓存
  const cacheable = !NON_CACHEABLE.has(name);
  const cacheKey = cacheable ? buildCacheKey(name, params) : "";
  if (cacheable) {
    const hit = cacheGet(cacheKey);
    if (hit) return hit;
  }

  // 未登录 + 未注册匿名态时，先注册一次再继续；register_anonimous 自身跳过避免递归
  if (name !== "register_anonimous") {
    await ensureAnonymousToken(session);
  }

  const query: Query = {
    ...params,
    cookie:
      typeof params.cookie === "string"
        ? cookieToJson(params.cookie)
        : (params.cookie as Record<string, string> | undefined) || { ...session },
  };

  // 注入国内 IP
  if (store.get("system.neteaseRealIp") && query.realIP === undefined) {
    query.realIP = sessionRealIp();
  }

  const res = await fn(query, createRequest);

  // 仅登录态变更接口才把响应 cookie 写回 SQLite
  if (SESSION_MUTATING.has(name) && res.cookie?.length) {
    const patch = parseSetCookie(res.cookie);
    if (Object.keys(patch).length) {
      persistSession({ ...loadSession(), ...patch });
      cacheClear();
    }
  }

  const value = { status: res.status, body: res.body };
  if (cacheable && res.status === 200) cacheSet(cacheKey, value);

  return value;
};

/** 调试用：当前 cookie 序列化字符串 */
export const currentCookieString = (): string => serialize(loadSession());
