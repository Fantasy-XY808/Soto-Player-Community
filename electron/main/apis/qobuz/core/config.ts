/**
 * Qobuz API 通用常量
 *
 * API 文档：https://www.qobuz.com/api.json/0.2/
 * 关键发现：
 * - 大部分端点 GET，无需签名；只需 X-App-Id header
 * - /track/getFileUrl 需要签名（直接 MD5，非 HMAC-MD5）+ X-User-Auth-Token
 * - app_secret 周期性轮换，Qobuz 会黑名单已知泄露的 secret
 *   → 必须配置多候选 + 启动期 test_secret() 自动 fail-over
 */

/** API base URL（与 api.qobuz.com 等价，但 www 子域返回更稳定） */
export const QOBUZ_API_BASE = "https://www.qobuz.com/api.json/0.2";

/** 固定 app_id（所有客户端共用） */
export const QOBUZ_APP_ID = "798273057";

/** 浏览器伪装 UA，避免被风控判为脚本 */
export const QOBUZ_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * 内置 app_secret 候选（来自多个开源仓库已硬编码，无需反编译 APK）
 *
 * 同一 app_id 可有多个 app_secret 同时有效；Qobuz 会周期性黑名单已泄露的 secret，
 * 必须配置多候选 + 启动期 test_secret() 自动 fail-over。
 *
 * 来源说明（仅供溯源，不嵌入 README）：
 * - android: Qobuz Android APK production（最稳定，仍在用）
 * - streamrip: streamrip / 衍生项目常用
 * - qo-dl-2019: 老版 Qo-DL（2019 年）
 * - parse-sdk: Parse SDK 凭证
 */
export interface AppSecretBuiltin {
  source: string;
  appId: string;
  appSecret: string;
}

export const BUILTIN_APP_SECRETS: AppSecretBuiltin[] = [
  { source: "android", appId: "798273057", appSecret: "05a4851e74ee47fda346f50cfdfc4f09" },
  { source: "streamrip", appId: "798273057", appSecret: "589be88e4538daea11f509d29e4a23b1" },
  { source: "qo-dl-2019", appId: "793410592", appSecret: "05a4851e74ee47fda346f50cfdfc4f09" },
  { source: "parse-sdk", appId: "798273057", appSecret: "abb21364945c0583309667d13ca3d93a" },
];

/**
 * Qobuz format_id 严格定义（参考 qobuz-dl 与公开 API 文档）
 *
 * 注意：format_id 27 = 24-bit ≤192kHz 最高，但完整流需 Studio Premier 订阅
 * Free 账号 credential.parameters 为空 → 服务端拒绝 stream（只能拿 30s preview）
 */
export const QobuzFormatId = {
  /** MP3 320 / 44.1kHz / 16bit —— 兜底 / 试听 */
  MP3_320: 5,
  /** 16-bit FLAC / 44.1kHz —— CD 音质 */
  FLAC_16BIT: 6,
  /** 24-bit FLAC / ≤96kHz —— Hi-Res 24bit/96kHz */
  FLAC_24BIT_96K: 7,
  /** 24-bit FLAC / ≤192kHz —— Hi-Res 24bit/192kHz 最高 */
  FLAC_24BIT_192K: 27,
} as const;

export type QobuzFormatIdValue = (typeof QobuzFormatId)[keyof typeof QobuzFormatId];

/** HTML 实体反转义（Qobuz 标题偶尔含 `&amp;`、`&#039;` 等） */
const ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#039;": "'",
};

export const decodeName = (str: string | null | undefined): string => {
  if (!str) return "";
  return str.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&apos;|&#039;/g, (s) => ENTITY_MAP[s] ?? s);
};
