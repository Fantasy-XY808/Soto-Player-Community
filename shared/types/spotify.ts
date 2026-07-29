/**
 * Spotify 账户共享类型
 *
 * 三种认证模式（用户在设置中选择）：
 * - client_credentials：应用级（client_id + client_secret → access_token），仅公开元数据
 * - pkce：用户级（浏览器登录 → access_token + refresh_token），可访问用户私有数据
 * - browser_cookie：浏览器 cookie 兑换（sp_dc → access_token），绕过 OAuth
 */

/** Spotify 认证模式 */
export type SpotifyAuthMode =
  | "none"
  | "client_credentials"
  | "pkce"
  | "browser_cookie";

/** Spotify 用户资料（精简版，经 IPC 返回给渲染端） */
export interface SpotifyProfile {
  id: string;
  display_name: string | null;
  email?: string;
  avatar?: string;
}

/** spotify:getStatus 返回值 */
export interface SpotifyStatusResult {
  /** 是否已配置 client_id / client_secret（应用级凭证） */
  clientConfigured: boolean;
  /** 是否已登录用户级（PKCE token 或浏览器 cookie） */
  userLoggedIn: boolean;
  /** 当前生效的认证模式 */
  authMode: SpotifyAuthMode;
  /** 用户资料；userLoggedIn=false 时为 null */
  profile: SpotifyProfile | null;
}

/** 通用操作结果（setClientCredentials / clearClientCredentials / logout 等） */
export type SpotifyOpResult = { ok: true } | { ok: false; error: string };

/** spotify:startLogin / spotify:startBrowserLogin 返回值 */
export type SpotifyLoginResult =
  | { ok: true; profile: SpotifyProfile | null }
  | { ok: false; error: string };

/** spotify:getClientCredentials 返回值（不暴露明文 secret） */
export interface SpotifyClientCredentialsInfo {
  configured: boolean;
  clientId: string;
}

/** 渲染进程 Spotify 账户 API（window.api.spotify） */
export interface SpotifyApi {
  /** 写入 client_id / client_secret（应用级凭证；空字符串视为清除） */
  setClientCredentials: (clientId: string, clientSecret: string) => Promise<SpotifyOpResult>;
  /** 查询是否已配置应用级凭证（不暴露明文 secret） */
  getClientCredentials: () => Promise<SpotifyClientCredentialsInfo>;
  /** 全量清除所有 Spotify 凭证（应用级 + 用户级 + 浏览器 cookie） */
  clearClientCredentials: () => Promise<SpotifyOpResult>;
  /** 启动 PKCE OAuth 登录流程：弹出登录窗口 → 授权码换 token → 落盘 */
  startLogin: () => Promise<SpotifyLoginResult>;
  /** 启动浏览器 cookie 模式登录：弹出窗口 → 收集 sp_dc → 写入凭证 */
  startBrowserLogin: () => Promise<SpotifyLoginResult>;
  /** 手动写入 sp_dc cookie 字符串 */
  setBrowserCookie: (cookie: string) => Promise<SpotifyOpResult>;
  /** 查询登录状态 + 用户资料 */
  getStatus: () => Promise<SpotifyStatusResult>;
  /** 登出：清除用户级 token + 浏览器 cookie（保留 client credentials） */
  logout: () => Promise<SpotifyOpResult>;
  /** 清除浏览器 cookie（保留 PKCE token） */
  clearBrowserCookie: () => Promise<SpotifyOpResult>;
}
