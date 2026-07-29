/**
 * Spotify API 通用常量
 *
 * 关键点：
 * - 公开 Web API：https://api.spotify.com/v1
 * - 认证端点：https://accounts.spotify.com/api/token
 * - 浏览器 cookie 兑换：https://open.spotify.com/get_access_token
 * - 三种认证模式：
 *   1. Client Credentials（应用级，用于 /v1/search 等公开接口）
 *   2. Authorization Code + PKCE（用户级，访问用户私有数据）
 *   3. 浏览器 cookie 兑换（sp_dc → access_token，绕过 OAuth）
 *
 * 注意：Spotify 不直接提供可播放的 MP3 URL，playable URL 需由插件或外部方案接管。
 */

/** Spotify Web API base */
export const SPOTIFY_API_BASE = "https://api.spotify.com/v1";

/** Spotify OAuth 授权地址 */
export const SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize";

/** Spotify Token 交换 / 刷新地址 */
export const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";

/** 浏览器 cookie 兑换 access token 地址 */
export const SPOTIFY_COOKIE_EXCHANGE_URL =
  "https://open.spotify.com/get_access_token?reason=transport&productType=web_player";

/** 本地回调地址（仅用于 PKCE 流程占位，实际由登录窗口拦截） */
export const SPOTIFY_REDIRECT_URI = "http://localhost/callback";

/** PKCE 请求权限范围 */
export const SPOTIFY_SCOPES =
  "user-read-private user-read-email playlist-read-private user-library-read";

/** 伪装 Chrome 124 桌面端 UA，避免被识别为 Electron */
export const SPOTIFY_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 提前过期阈值（毫秒）：避免边界 race */
export const TOKEN_EXPIRE_BUFFER_MS = 60_000;
