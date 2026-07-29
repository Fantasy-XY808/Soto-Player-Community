/**
 * Tidal 账户共享类型
 *
 * Tidal 用 OAuth 2.0 + PKCE 鉴权（无 client_secret，公共桌面客户端凭据）：
 * - 凭证文件：{configDir}/tidal.json，含 access_token / refresh_token / expires_at / 订阅等级
 * - safeStorage 加密落盘（与 Qobuz 一致）
 * - HiFi 订阅 → 16bit/44.1kHz FLAC；HiFi+ 订阅 → 24bit/96kHz/192kHz MQA-FLAC
 */

/** Tidal 订阅等级 */
export type TidalSubscription = "free" | "hifi" | "hifi_plus" | "unknown";

/** fetchStatus 返回的用户资料 */
export interface TidalProfile {
  /** 昵称 */
  nickname: string;
  /** 订阅等级；free 仅 AAC 96kbps，hifi 才能拿 16bit FLAC */
  subscription: TidalSubscription;
  /** 用户 ID（Tidal 数字 ID 字符串） */
  userId?: string;
}

/** fetchStatus 返回值 */
export type TidalStatusResult = { ok: true; profile: TidalProfile } | { ok: false; error: string };

/** setToken / clearToken / refreshToken / completeOauth 返回值 */
export type TidalOpResult = { ok: true } | { ok: false; error: string };

/** OAuth + PKCE 流程提交的凭证（callback 拿到 code 后主进程交换 token 后落盘） */
export interface TidalTokenPayload {
  /** access_token（API 鉴权用） */
  accessToken: string;
  /** refresh_token（access_token 过期后用其刷新） */
  refreshToken: string;
  /** access_token 过期时间（unix 毫秒时间戳） */
  expiresAt: number;
  /** 订阅等级（从 /users/me 响应解析） */
  subscription: TidalSubscription;
  /** 昵称（从 /users/me 响应解析） */
  nickname: string;
  /** 用户 ID（从 /users/me 响应解析） */
  userId?: string;
}

/** startOauth 返回的授权 URL（渲染端打开浏览器跳转） */
export interface TidalOauthStartResult {
  /** 完整的 Tidal 授权 URL（含 client_id / scope / code_challenge / state） */
  authorizeUrl: string;
}

/** completeOauth 返回值（含 profile，供渲染端直接展示） */
export type TidalCompleteResult =
  | { ok: true; profile: TidalProfile }
  | { ok: false; error: string };

/** 渲染进程 Tidal 账户 API（window.api.tidal） */
export interface TidalApi {
  /** 启动 OAuth + PKCE 流程：返回授权 URL 给渲染端打开浏览器 */
  startOauth: () => Promise<TidalOauthStartResult>;
  /** 等待本地 callback server 收到 code，交换 token 并落盘 */
  completeOauth: () => Promise<TidalCompleteResult>;
  /** 取消正在进行的 OAuth 流程（清理 callback server，主动 reject 等待中的 completeOauth） */
  cancelOauth: () => Promise<void>;
  /** 加密落盘 access_token / refresh_token / 订阅等级 */
  setToken: (payload: TidalTokenPayload) => Promise<TidalOpResult>;
  /** 读取并解密凭证；未登录返回 null */
  getToken: () => Promise<TidalTokenPayload | null>;
  /** 删除凭证文件 */
  clearToken: () => Promise<TidalOpResult>;
  /** 用 access_token 调 /users/me 验证登录态，返回资料 */
  fetchStatus: () => Promise<TidalStatusResult>;
  /** 强制刷新 access_token（用 refresh_token 走 /oauth2/token） */
  refreshToken: () => Promise<TidalOpResult>;
  /**
   * 下载一首歌到指定路径，用于本地频谱检测（验证是否掺水）
   *
   * 内部流程：调 song_url 拿 CDN 直链 → overseasFetch 下载流 → 写入 outputPath
   * @param trackId   Tidal track id
   * @param outputPath 输出文件绝对路径（用户自选）；父目录必须存在
   */
  downloadTrack: (
    trackId: string,
    outputPath: string,
  ) => Promise<TidalDownloadResult>;
}

/** 下载结果 */
export interface TidalDownloadResult {
  ok: boolean;
  /** 成功时为输出文件路径 */
  path?: string;
  /** 成功时为文件大小（字节） */
  sizeBytes?: number;
  /** 音频位深（如 16 / 24），来自 manifest 解码 */
  bitDepth?: number;
  /** 采样率（kHz，如 44.1 / 96 / 192） */
  samplingRate?: number;
  /** MIME 类型（如 audio/flac） */
  mimeType?: string;
  /** 失败原因 */
  error?: string;
}
