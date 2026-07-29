/**
 * ProStudioMasters 账户共享类型
 *
 * ProStudioMasters 不用 cookie 鉴权，而用 session token（用户在 prostudiomasters.com
 * 登录后从浏览器 DevTools 录取）。签名算法未知，应用只做 HTTP 代理。
 *
 * - 凭证文件：{configDir}/prostudiomasters.json，含 session token + nickname + userId
 * - safeStorage 加密落盘
 * - fetchStatus 不调远端 profile API（PSM 无公开 profile 接口），仅校验 token 存在性
 *
 * AGPL 合规：用户自带凭据访问自己付费的内容，应用只做 HTTP 代理
 */

/** 用户登录提交的凭证（session token 直接录入） */
export interface PsmTokenPayload {
  /** session token（Bearer JWT / Cookie 串 / 任意不透明字符串） */
  sessionToken: string;
  /** 昵称（用户自带凭据访问自己付费的内容；UI 展示用） */
  nickname: string;
  /** 用户 ID（可选，PSM 内部数字 ID） */
  userId?: string;
}

/** fetchStatus 返回的用户资料 */
export interface PsmProfile {
  /** 昵称 */
  nickname: string;
  /** 用户 ID（PSM 数字 ID，可选） */
  userId?: string;
}

/** fetchStatus 返回值 */
export interface PsmStatusResult {
  ok: boolean;
  /** 成功时返回昵称 */
  nickname?: string;
  /** 失败时返回错误描述 */
  error?: string;
}

/** 渲染进程 ProStudioMasters 账户 API（window.api.prostudiomasters） */
export interface PsmApi {
  /** 加密落盘 session token */
  setToken(payload: PsmTokenPayload): Promise<void>;
  /** 读取并解密凭证；未登录返回 null */
  getToken(): Promise<PsmTokenPayload | null>;
  /** 删除凭证文件 */
  clearToken(): Promise<void>;
  /** 校验 token 存在性（PSM 无 profile API，仅校验凭据存在） */
  fetchStatus(): Promise<PsmStatusResult>;
}
