/**
 * Bilibili 账户共享类型
 */

/** fetchStatus 返回的用户资料 */
export interface BilibiliProfile {
  /** 昵称（接口未稳定返回时由 uid 兜底派生） */
  nickname: string;
  /** VIP 类型，0 = 非 VIP；B站仅区分 0/1（普通用户/大会员） */
  vipType: number;
}

/** fetchStatus 返回值 */
export type BilibiliStatusResult =
  | { ok: true; profile: BilibiliProfile }
  | { ok: false; error: string };

/** setCookie / clearCookie 返回值 */
export type BilibiliOpResult = { ok: true } | { ok: false; error: string };

/** 渲染进程 Bilibili 账户 API（window.api.bilibili） */
export interface BilibiliApi {
  /** 加密落盘 cookie */
  setCookie: (cookie: string) => Promise<BilibiliOpResult>;
  /** 读取并解密 cookie；未登录返回 null */
  getCookie: () => Promise<string | null>;
  /** 删除凭证文件 */
  clearCookie: () => Promise<BilibiliOpResult>;
  /** 打开 Bilibili 网页登录窗口，登录成功后直接落盘 cookie */
  openLoginWeb: () => Promise<BilibiliOpResult>;
  /** 用 cookie 验证登录态并返回资料 */
  fetchStatus: () => Promise<BilibiliStatusResult>;
}
