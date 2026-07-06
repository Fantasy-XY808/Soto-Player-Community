/**
 * QQ 音乐账户共享类型
 */

/** fetchStatus 返回的用户资料 */
export interface QqmusicProfile {
  /** 昵称（接口未稳定返回时由 uin 兜底派生） */
  nickname: string;
  /** VIP 类型，0 = 非 VIP */
  vipType: number;
}

/** fetchStatus 返回值 */
export type QqmusicStatusResult =
  | { ok: true; profile: QqmusicProfile }
  | { ok: false; error: string };

/** setCookie / clearCookie 返回值 */
export type QqmusicOpResult = { ok: true } | { ok: false; error: string };

/** 渲染进程 QQ 音乐账户 API（window.api.qqmusic） */
export interface QqmusicApi {
  /** 加密落盘 cookie */
  setCookie: (cookie: string) => Promise<QqmusicOpResult>;
  /** 读取并解密 cookie；未登录返回 null */
  getCookie: () => Promise<string | null>;
  /** 删除凭证文件 */
  clearCookie: () => Promise<QqmusicOpResult>;
  /** 用 cookie 验证登录态并返回资料 */
  fetchStatus: () => Promise<QqmusicStatusResult>;
}
