/**
 * Spotify 浏览器登录窗口
 *
 * 同一窗口支持两种模式（按入参区分）：
 *
 * 1. Cookie 模式（默认，不传参）
 *    加载 https://open.spotify.com，轮询 cookie sp_dc 出现即返回完整 cookie 字符串。
 *    用于浏览器 cookie 兑换模式：sp_dc → open.spotify.com/get_access_token → access_token。
 *
 * 2. OAuth + PKCE 模式（传入 authUrl）
 *    加载 Spotify 授权 URL，拦截重定向到 REDIRECT_URI（http://localhost/callback?code=...）
 *    时提取 code 参数返回。auth.ts 用 code + code_verifier 换 access_token + refresh_token。
 *
 * 同一时刻只允许一个登录窗口存在；分区 persist:spotify-login 隔离 cookie。
 */

import { BrowserWindow, session } from "electron";
import { getMainWindow } from "./main";
import { coreLog } from "@main/utils/logger";
import { SPOTIFY_REDIRECT_URI } from "@main/apis/spotify/core/config";

const LOGIN_PARTITION = "persist:spotify-login";

/** Cookie 模式默认登录页 */
const COOKIE_LOGIN_URL = "https://open.spotify.com";

/** Cookie 模式判定：cookie 中必须包含 sp_dc 才视为已登录 */
const LOGIN_COOKIE_KEY = "sp_dc";

/**
 * 伪装成普通桌面 Chrome 124
 * 默认 UA 含 "Electron/..."，Spotify 会判定为不受支持环境
 */
const FAKE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let activeWin: BrowserWindow | null = null;
let pollTimer: NodeJS.Timeout | null = null;

const getLoginSession = (): Electron.Session => session.fromPartition(LOGIN_PARTITION);

const stopPolling = (): void => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
};

/**
 * 从重定向 URL 中提取 OAuth code 参数
 * @param url 重定向 URL（http://localhost/callback?code=xxx&state=yyy）
 * @returns code 字符串；不含 code 返回 null
 */
const extractCodeFromUrl = (url: string): string | null => {
  try {
    const u = new URL(url);
    const code = u.searchParams.get("code");
    return code || null;
  } catch {
    return null;
  }
};

/**
 * 收集登录会话中的 cookie（Cookie 模式）
 * @returns 含 sp_dc 时返回完整 cookie 字符串，否则 null
 */
const collectCookieString = async (): Promise<string | null> => {
  const ses = getLoginSession();
  const all = await ses.cookies.get({ url: "https://open.spotify.com" });
  const loginCookie = all.find((c) => c.name === LOGIN_COOKIE_KEY && c.value);
  if (!loginCookie?.value) return null;

  const parts: string[] = [];
  for (const c of all) {
    if (!c.value) continue;
    parts.push(`${c.name}=${c.value}`);
  }
  return parts.join("; ");
};

/**
 * 打开 Spotify 浏览器登录窗口
 *
 * @param authUrl  可选：OAuth + PKCE 授权 URL
 *                 - 不传：进入 Cookie 模式，返回 sp_dc cookie 字符串
 *                 - 传入：进入 OAuth 模式，拦截重定向返回授权 code 字符串
 * @returns 登录成功返回字符串（cookie 或 code）；用户关闭窗口返回 null
 */
export const openSpotifyBrowserLoginWindow = async (
  authUrl?: string,
): Promise<string | null> => {
  // 已存在则先聚焦，避免重复开窗
  if (activeWin && !activeWin.isDestroyed()) {
    activeWin.focus();
    return null;
  }

  const isOauthMode = !!authUrl;
  const targetUrl = isOauthMode ? authUrl! : COOKIE_LOGIN_URL;

  // 清掉旧的登录会话，避免残留 cookie / state 干扰
  const ses = getLoginSession();
  await ses.clearStorageData({ storages: ["cookies", "localstorage", "indexdb"] });
  ses.setUserAgent(FAKE_UA);

  const parent = getMainWindow() ?? undefined;

  activeWin = new BrowserWindow({
    parent,
    modal: false,
    width: 1024,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    center: true,
    title: isOauthMode ? "登录 Spotify (OAuth)" : "登录 Spotify",
    autoHideMenuBar: true,
    backgroundColor: "#121212",
    show: false,
    webPreferences: {
      session: ses,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  activeWin.webContents.setUserAgent(FAKE_UA);
  activeWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  return await new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (result: string | null): void => {
      if (settled) return;
      settled = true;
      stopPolling();
      if (activeWin && !activeWin.isDestroyed()) activeWin.destroy();
      activeWin = null;
      resolve(result);
    };

    activeWin!.once("ready-to-show", () => activeWin?.show());

    // OAuth 模式：拦截重定向到 REDIRECT_URI，提取 code 后立即关闭
    if (isOauthMode) {
      const onRedirect = (url: string): void => {
        if (!url.startsWith(SPOTIFY_REDIRECT_URI)) return;
        const code = extractCodeFromUrl(url);
        if (code) {
          coreLog.info("[spotify-login] OAuth code captured");
          finish(code);
        }
      };
      activeWin!.webContents.on("will-redirect", (_e, url) => {
        onRedirect(url);
      });
      activeWin!.webContents.on("will-navigate", (_e, url) => {
        onRedirect(url);
      });
    } else {
      // Cookie 模式：dom-ready 后轮询 sp_dc
      activeWin!.webContents.once("dom-ready", () => {
        stopPolling();
        pollTimer = setInterval(async () => {
          try {
            const cookies = await collectCookieString();
            if (cookies) finish(cookies);
          } catch (err) {
            coreLog.warn("[spotify-login] poll cookies failed:", err);
          }
        }, 1000);
        pollTimer?.unref?.();
      });
    }

    activeWin!.on("closed", () => finish(null));

    activeWin!.loadURL(targetUrl, { userAgent: FAKE_UA }).catch((err) => {
      coreLog.error("[spotify-login] loadURL failed:", err);
      finish(null);
    });
  });
};

/**
 * 关闭正在进行的 Spotify 登录窗口（用户取消 / 模式切换时调用）
 */
export const closeSpotifyBrowserLoginWindow = (): void => {
  stopPolling();
  if (activeWin && !activeWin.isDestroyed()) {
    try {
      activeWin.destroy();
    } catch {
      // 窗口已销毁时忽略
    }
  }
  activeWin = null;
};
