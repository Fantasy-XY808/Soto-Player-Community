/**
 * 酷狗 cookie / token 管理
 *
 * 酷狗会话凭证与传统 cookie 概念略不同：
 *   - 关键字段：token / userid / vip_type / vip_token
 *   - 这些字段从 /v9/login_by_pwd 响应中获取，由服务端返回 secu_params 解密后得到
 *   - 后续调用其他酷狗接口时作为 query 参数拼到 URL 上
 *
 * 存储复用现有 ipc/kugou.ts 的文件方案（kugou.json + safeStorage 加密）：
 *   - getKugouCookieSync() 返回 cookie 字符串
 *   - setKugouCookie / clearKugouCookie 用于登录/登出
 * 这里在文件存储之上提供凭证对象语义（userid/token/nickname/pic），
 * 供 PlatformLoginAdapter 与 UI 使用
 */

import { getKugouCookieSync } from "@main/ipc/kugou";
import { cookieToJson } from "@main/apis/netease/core/cookie";

/** 酷狗关键凭证字段（从 cookie 字符串解析得到） */
export interface KugouCredentials {
  /** 用户 ID */
  userid: string;
  /** 登录 token */
  token: string;
  /** VIP 类型（0 = 非 VIP） */
  vip_type: string;
  /** VIP token */
  vip_token: string;
  /** 昵称 */
  nickname?: string;
  /** 头像 URL */
  pic?: string;
}

const EMPTY: KugouCredentials = {
  userid: "",
  token: "",
  vip_type: "0",
  vip_token: "",
};

/**
 * 从 cookie 字符串解析出凭证对象
 * @param cookieStr cookie 字符串（kugou.json 中存的明文）
 */
const parseCredentials = (cookieStr: string | null): KugouCredentials => {
  if (!cookieStr) return { ...EMPTY };
  const obj = cookieToJson(cookieStr);
  return {
    userid: obj.userid ?? "",
    token: obj.token ?? "",
    vip_type: obj.vip_type ?? "0",
    vip_token: obj.vip_token ?? "",
    nickname: obj.nickname,
    pic: obj.pic,
  };
};

/**
 * 获取当前酷狗凭证
 *
 * 内部每次调用都从 getKugouCookieSync() 读最新值，避免登录后内存脏数据
 */
export const getKugouCredentials = (): KugouCredentials =>
  parseCredentials(getKugouCookieSync());

/** 酷狗是否已登录（userid + token 同时存在） */
export const isKugouLoggedIn = (): boolean => {
  const c = getKugouCredentials();
  return !!c.userid && !!c.token;
};

/** 把凭证对象序列化为 cookie 字符串（用于登录成功后写入 kugou.json） */
export const credentialsToCookieString = (creds: KugouCredentials): string =>
  [
    `userid=${creds.userid}`,
    `token=${creds.token}`,
    `vip_type=${creds.vip_type}`,
    `vip_token=${creds.vip_token}`,
    creds.nickname ? `nickname=${encodeURIComponent(creds.nickname)}` : "",
    creds.pic ? `pic=${encodeURIComponent(creds.pic)}` : "",
  ]
    .filter(Boolean)
    .join("; ");

/** 把 cookie 字符串解析为对象（与网易云共用） */
export const parseKugouCookieString = (cookie: string): Record<string, string> =>
  cookieToJson(cookie);
