/**
 * 酷狗音乐账户共享类型
 */

/** fetchStatus 返回的用户资料 */
export interface KugouProfile {
  /** 昵称 */
  nickname: string;
  /** VIP 类型，0 = 非 VIP */
  vipType: number;
}

/** fetchStatus 返回值 */
export type KugouStatusResult = { ok: true; profile: KugouProfile } | { ok: false; error: string };

/** setCookie / clearCookie 返回值 */
export type KugouOpResult = { ok: true } | { ok: false; error: string };

/** 渲染进程酷狗账户 API（window.api.kugou） */
export interface KugouApi {
  /** 加密落盘 cookie */
  setCookie: (cookie: string) => Promise<KugouOpResult>;
  /** 读取并解密 cookie；未登录返回 null */
  getCookie: () => Promise<string | null>;
  /** 删除凭证文件 */
  clearCookie: () => Promise<KugouOpResult>;
  /** 用 cookie 验证登录态并返回资料 */
  fetchStatus: () => Promise<KugouStatusResult>;
}
