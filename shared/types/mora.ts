/**
 * mora 账户共享类型
 *
 * mora 是日本索尼 Hi-Res 商店，Nuxt.js SSR 应用：
 * - 试听 + 元数据：B 级（可接入），抓 mora.jp/packages/{label}/{id}/ HTML → 提取 __NUXT_DATA__ JSON
 * - 完整流：D 级（不接入，下载商店无流媒体能力）
 * - 试听无需凭证；购买用户私有元数据才需 cookie/session 存 safeStorage → {configDir}/mora.json
 *
 * 与 qobuz 之不同：
 * - 凭证是 cookie 字符串（不是 user_auth_token + app_secret 签名）
 * - mora 无 profile API，fetchStatus 仅校验 cookie 文件存在性 + 解密成功
 * - profile 仅含 nickname（mora 不暴露 userId 等内部字段）
 */

/** fetchStatus 返回的用户资料（mora 无 profile API，仅含昵称） */
export interface MoraProfile {
  /** 昵称（用户录入时填入，默认 "mora 用户"） */
  nickname: string;
  /** 用户 ID（mora 不暴露，留空） */
  userId?: string;
}

/** fetchStatus 返回值：mora 无 profile API，仅校验 cookie 存在性 */
export interface MoraStatusResult {
  ok: boolean;
  /** 成功时返回昵称 */
  nickname?: string;
  /** 失败时返回原因 */
  error?: string;
}

/** setToken / clearToken 返回值 */
export type MoraOpResult = { ok: true } | { ok: false; error: string };

/** 用户登录提交的凭证（cookie 字符串直接录入） */
export interface MoraTokenPayload {
  /** cookie 字符串（如 `session_id=xxx; user_id=yyy`） */
  cookie: string;
  /** 昵称（用户录入时填入，默认 "mora 用户"） */
  nickname: string;
  /** 用户 ID（mora 不暴露，可选） */
  userId?: string;
}

/** 渲染进程 mora 账户 API（window.api.mora） */
export interface MoraApi {
  /** 加密落盘 cookie + 昵称；失败抛错 */
  setToken: (payload: MoraTokenPayload) => Promise<void>;
  /** 读取并解密凭证；未登录返回 null */
  getToken: () => Promise<MoraTokenPayload | null>;
  /** 删除凭证文件；失败抛错 */
  clearToken: () => Promise<void>;
  /** 校验 cookie 文件存在性并返回昵称（mora 无 profile API） */
  fetchStatus: () => Promise<MoraStatusResult>;
}
