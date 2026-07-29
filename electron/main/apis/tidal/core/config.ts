/**
 * Tidal API 通用常量
 *
 * API 文档：https://developer.tidal.com/
 * 关键发现：
 * - OAuth 2.0 + PKCE 流程（公共桌面客户端凭据，无 client_secret）
 * - access_token 1 小时过期，需用 refresh_token 自动刷新
 * - /tracks/{id}/playbackinfopostpaywall 返回 manifest（base64 编码 JSON，含 CDN 直链）
 * - HiFi 订阅 → 16bit/44.1kHz FLAC；HiFi+ 订阅 → 24bit/96kHz/192kHz MQA-FLAC
 */

/** API base URL（v1 端点） */
export const TIDAL_API_BASE = "https://api.tidal.com/v1";

/** OAuth 登录 base URL（授权 + token 端点） */
export const TIDAL_LOGIN_BASE = "https://login.tidal.com";

/**
 * 公开 TIDAL Partner client_id
 *
 * 来自多个开源项目（tidal-wave / redsea 等）已硬编码的桌面客户端凭据，
 * 无需 client_secret，配合 PKCE 即可走 OAuth 流程。
 */
export const TIDAL_CLIENT_ID = "ZUfzt6fNIf5Wr4IM7t7IDb3Me3usOQtH";

/** OAuth 回调地址（与 Tidal 桌面客户端惯例一致） */
export const TIDAL_REDIRECT_URI = "http://localhost:1419/callback";

/** OAuth 回调监听端口 */
export const TIDAL_REDIRECT_PORT = 1419;

/** OAuth scope（用户读取 + 订阅信息 + 播放 + 资源读取 + 收藏读取） */
export const TIDAL_SCOPES = [
  "user.read",
  "user.read.email",
  "user.read.subscriptions",
  "playback",
  "read-resources",
  "collection.read",
].join(" ");

/** 浏览器伪装 UA（与 Qobuz 一致，避免被风控判为脚本） */
export const TIDAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** HTML 实体反转义（Tidal 标题偶尔含 `&amp;`、`&#039;` 等） */
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

/**
 * 把 Tidal album.cover UUID 拼接成图片 URL
 *
 * Tidal 返回的 cover 字段是形如 "a1b2c3d4-e5f6-7890-abcd-ef1234567890" 的 UUID，
 * 需去掉连字符后拼成 `https://resources.tidal.com/images/{uuid无连字符}/{w}x{h}.jpg`。
 *
 * @param uuid Tidal album.cover 原始 UUID
 * @param size 图片尺寸，默认 160x160（搜索列表用），专辑详情可用 320x320 / 640x640 / 1280x1280
 */
export const tidalCoverUrl = (
  uuid: string | null | undefined,
  size = "160x160",
): string | undefined => {
  if (!uuid) return undefined;
  const stripped = uuid.replace(/-/g, "");
  if (!stripped) return undefined;
  return `https://resources.tidal.com/images/${stripped}/${size}.jpg`;
};
