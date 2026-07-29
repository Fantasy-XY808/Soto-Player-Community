/**
 * Qobuz 账户共享类型
 *
 * Qobuz 不用 cookie 鉴权，而用 user_auth_token（登录后获得）+ app_id/app_secret 签名。
 * - 凭证文件：{configDir}/qobuz.json，含 user_auth_token + 订阅等级 + app_secret 候选
 * - safeStorage 加密落盘
 */

/** Qobuz 订阅等级 */
export type QobuzSubscription =
  | "free"
  | "studio_premier"
  | "studio_sublime"
  | "unknown";

/** fetchStatus 返回的用户资料 */
export interface QobuzProfile {
  /** 昵称 */
  nickname: string;
  /** 订阅等级；free 账号无法 stream 完整曲目，只能拿 30s preview */
  subscription: QobuzSubscription;
  /** 用户 ID（Qobuz 数字 ID） */
  userId?: number;
}

/** fetchStatus 返回值 */
export type QobuzStatusResult = { ok: true; profile: QobuzProfile } | { ok: false; error: string };

/** setToken / clearToken / setAppSecrets 返回值 */
export type QobuzOpResult = { ok: true } | { ok: false; error: string };

/** 用户登录提交的凭证（user_auth_token 直接录入或用户名密码登录后写入） */
export interface QobuzTokenPayload {
  /** /user/login 返回的 user_auth_token */
  userAuthToken: string;
  /** 订阅等级（从 /user/login 响应解析，free/premier/sublime） */
  subscription: QobuzSubscription;
  /** 昵称（从 /user/login 响应解析） */
  nickname: string;
  /** 用户 ID（从 /user/login 响应解析） */
  userId?: number;
}

/** app_secret 候选项（多候选 + 启动期 test_secret 自动 fail-over） */
export interface QobuzAppSecretEntry {
  /** 来源标识，如 "android" / "streamrip" / "qo-dl-2019" / "parse-sdk" */
  source: string;
  /** app_id（同一 app_id 可有多个 app_secret 同时有效） */
  appId: string;
  /** app_secret（32 位十六进制） */
  appSecret: string;
}

/** 渲染进程 Qobuz 账户 API（window.api.qobuz） */
export interface QobuzApi {
  /** 加密落盘 user_auth_token + 订阅等级 */
  setToken: (payload: QobuzTokenPayload) => Promise<QobuzOpResult>;
  /** 读取并解密凭证；未登录返回 null */
  getToken: () => Promise<QobuzTokenPayload | null>;
  /** 删除凭证文件 */
  clearToken: () => Promise<QobuzOpResult>;
  /** 用 user_auth_token 调 /user/login（带 token）验证，返回资料 */
  fetchStatus: () => Promise<QobuzStatusResult>;
  /** 读取用户自定义的 app_secret 候选列表（含内置默认 + 用户追加） */
  getAppSecrets: () => Promise<QobuzAppSecretEntry[]>;
  /** 更新用户自定义 app_secret 候选列表（覆盖式写入） */
  setAppSecrets: (entries: QobuzAppSecretEntry[]) => Promise<QobuzOpResult>;
  /** 用用户名密码登录 Qobuz，返回 user_auth_token + 订阅等级 */
  login: (username: string, password: string) => Promise<
    { ok: true; profile: QobuzProfile } | { ok: false; error: string }
  >;
  /**
   * 下载一首歌到指定路径，用于本地频谱检测（验证是否掺水）
   *
   * 内部流程：调 song_url 拿 CDN 直链 → overseasFetch 下载流 → 写入 outputPath
   * @param trackId    Qobuz track id
   * @param outputPath 输出文件绝对路径（用户自选）；父目录必须存在
   * @param formatId   可选 format_id（5=MP3 320 / 6=FLAC 16bit / 7=FLAC 24bit≤96kHz / 27=FLAC 24bit≤192kHz）；不传按订阅等级自动选
   */
  downloadTrack: (
    trackId: string,
    outputPath: string,
    formatId?: number,
  ) => Promise<QobuzDownloadResult>;
}

/** 下载结果 */
export interface QobuzDownloadResult {
  ok: boolean;
  /** 成功时为输出文件路径 */
  path?: string;
  /** 成功时为文件大小（字节） */
  sizeBytes?: number;
  /** 音频位深（如 16 / 24） */
  bitDepth?: number;
  /** 采样率（kHz，如 44.1 / 96 / 192） */
  samplingRate?: number;
  /** format_id（5/6/7/27） */
  formatId?: number;
  /** MIME 类型（如 audio/flac） */
  mimeType?: string;
  /** 失败原因 */
  error?: string;
}
