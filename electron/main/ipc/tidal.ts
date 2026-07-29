/**
 * Tidal 账户 IPC
 *
 * 与 Qobuz 之不同：
 * - 鉴权用 OAuth 2.0 + PKCE（access_token + refresh_token），不是 user_auth_token
 * - 凭证文件：{configDir}/tidal.json，token 经 safeStorage 加密落盘
 * - access_token 1 小时过期，需用 refresh_token 自动刷新（剩余 < 5 分钟时触发）
 * - startOauth / completeOauth：浏览器跳转 + 本地 callback server 接收 code
 * - setToken / getToken / clearToken：token 凭证管理
 * - fetchStatus：用 access_token 调 /users/me 验证，返回用户资料 + 订阅等级
 * - getTidalTokenSync：同步读盘 + 解密，供 apis/tidal/core/request.ts 注入 Authorization header
 * - persistRefreshedToken：刷新 token 后落盘新 access_token（保留原 subscription / nickname）
 * - invalidateTidalToken：token 失效时调用，下次调用会重新走 refresh
 */

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ipcMain, safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { tidalLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import { readCachedJsonSync, invalidateCachedFile } from "@main/utils/cachedFileReader";
import { callTidal } from "@main/apis/tidal";
import { overseasFetch } from "@main/services/proxyDispatcher";
import { TIDAL_API_BASE, TIDAL_UA } from "@main/apis/tidal/core/config";
import {
  cancelOauthFlow,
  cleanupSession,
  normalizeSubscription,
  refreshAccessToken,
  startOauthFlow,
  waitForCallback,
} from "@main/apis/tidal/core/oauth";
import type {
  TidalCompleteResult,
  TidalDownloadResult,
  TidalOpResult,
  TidalProfile,
  TidalStatusResult,
  TidalSubscription,
  TidalTokenPayload,
} from "@shared/types/tidal";

const TOKEN_FILE = path.join(configDir, "tidal.json");

/** access_token 剩余 < 5 分钟时自动刷新 */
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

interface PersistedTokenState {
  /** 加密后的 access_token（base64） */
  encryptedAccessToken: string;
  /** 加密后的 refresh_token（base64） */
  encryptedRefreshToken: string;
  /** access_token 过期时间（unix 毫秒时间戳，明文存便于刷新判断） */
  expiresAt: number;
  /** 订阅等级（明文存，无需解密读取，便于拉流时直接判 streamable） */
  subscription: TidalSubscription;
  nickname: string;
  userId?: string;
}

// ── token 加解密 ────────────────────────────────────────────────────────────

const encryptToken = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    tidalLog.warn("系统安全存储不可用，Tidal token 将以 base64 形式明文落盘");
    return Buffer.from(plain, "utf-8").toString("base64");
  }
  return safeStorage.encryptString(plain).toString("base64");
};

const decryptToken = (encrypted: string): string => {
  if (!encrypted) return "";
  try {
    const buf = Buffer.from(encrypted, "base64");
    if (!safeStorage.isEncryptionAvailable()) return buf.toString("utf-8");
    return safeStorage.decryptString(buf);
  } catch {
    return "";
  }
};

/**
 * 同步读盘 + 解密，返回完整 token payload 或 null
 *
 * 使用 readCachedJsonSync 内存缓存：每个网络请求都会调用本函数，
 * 缓存命中后仅 statSync 比对 mtime，避免高频 readFileSync + JSON.parse 阻塞事件循环。
 * 供 apis/tidal/core/request.ts 注入 Authorization header 用。
 */
export const getTidalTokenSync = (): TidalTokenPayload | null => {
  try {
    const raw = readCachedJsonSync<PersistedTokenState>(TOKEN_FILE);
    if (!raw) return null;
    const accessToken = decryptToken(raw.encryptedAccessToken ?? "");
    const refreshToken = decryptToken(raw.encryptedRefreshToken ?? "");
    if (!accessToken || !refreshToken) return null;
    return {
      accessToken,
      refreshToken,
      expiresAt: raw.expiresAt ?? 0,
      subscription: raw.subscription ?? "unknown",
      nickname: raw.nickname ?? "",
      userId: raw.userId,
    };
  } catch {
    return null;
  }
};

/**
 * 标记 token 失效（401 时调用，下次调用会重新走 refresh）
 *
 * 实现策略：把 expiresAt 设为 0，触发自动刷新逻辑。
 */
export const invalidateTidalToken = (): void => {
  try {
    const raw = readCachedJsonSync<PersistedTokenState>(TOKEN_FILE);
    if (!raw) return;
    raw.expiresAt = 0;
    atomicWriteSync(TOKEN_FILE, JSON.stringify(raw, null, 2));
    invalidateCachedFile(TOKEN_FILE);
    tidalLog.warn("[ERR-12031-A] Tidal token 已标记失效，下次调用将触发刷新");
  } catch (err) {
    tidalLog.warn("[ERR-12031-A] Tidal 标记 token 失效失败:", err);
  }
};

/**
 * 刷新 token 后落盘新 access_token（保留原 subscription / nickname）
 *
 * 由 song_url 模块在 401 时自动调用，避免渲染端介入。
 */
export const persistRefreshedToken = (payload: {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}): void => {
  try {
    const raw = readCachedJsonSync<PersistedTokenState>(TOKEN_FILE);
    if (!raw) {
      tidalLog.warn("[ERR-12025-A] Tidal token 文件不存在，无法持久化刷新结果");
      return;
    }
    raw.encryptedAccessToken = encryptToken(payload.accessToken);
    raw.encryptedRefreshToken = encryptToken(payload.refreshToken);
    raw.expiresAt = payload.expiresAt;
    atomicWriteSync(TOKEN_FILE, JSON.stringify(raw, null, 2));
    invalidateCachedFile(TOKEN_FILE);
    tidalLog.info("[ERR-12024-A] Tidal token 已刷新并落盘");
  } catch (err) {
    tidalLog.error("[ERR-12025-A] Tidal token 刷新落盘失败:", err);
  }
};

// ── /users/me 验证 ──────────────────────────────────────────────────────────

interface TidalUsersMeResp {
  id?: number | string;
  username?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  subscription?: {
    type?: string;
    status?: string;
  };
}

/**
 * 用 access_token 调 /users/me 验证登录态并返回 profile
 *
 * 同时检查 access_token 是否快过期（剩余 < 5 分钟），是则自动刷新。
 */
const verifyToken = async (
  token: TidalTokenPayload,
): Promise<{ ok: true; profile: TidalProfile } | { ok: false; error: string }> => {
  try {
    const res = await overseasFetch(`${TIDAL_API_BASE}/users/me`, {
      method: "GET",
      headers: {
        "User-Agent": TIDAL_UA,
        Authorization: `Bearer ${token.accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 200) return { ok: false, error: `Tidal HTTP ${res.status}` };
    const body = (await res.json()) as TidalUsersMeResp;

    const subscription = normalizeSubscription(body);
    const nickname =
      body.username ??
      [body.firstName, body.lastName].filter(Boolean).join(" ") ??
      body.email ??
      "Tidal User";

    const profile: TidalProfile = {
      nickname,
      subscription,
      userId: body.id != null ? String(body.id) : undefined,
    };
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

/**
 * 检查 access_token 是否快过期，是则用 refresh_token 刷新
 *
 * 剩余 < 5 分钟时触发；失败时静默（保留旧 token，下次 401 会再触发刷新）。
 */
const ensureFreshAccessToken = async (): Promise<void> => {
  const token = getTidalTokenSync();
  if (!token?.refreshToken) return;
  const remaining = token.expiresAt - Date.now();
  if (remaining > REFRESH_THRESHOLD_MS) return;

  tidalLog.info(
    `[ERR-12024-A] Tidal access_token 剩余 ${Math.round(remaining / 1000)}s < 5min，触发刷新`,
  );
  try {
    const tokenResp = await refreshAccessToken(token.refreshToken);
    persistRefreshedToken({
      accessToken: tokenResp.access_token,
      refreshToken: tokenResp.refresh_token || token.refreshToken,
      expiresAt: Date.now() + tokenResp.expires_in * 1000,
    });
  } catch (err) {
    tidalLog.warn("[ERR-12025-A] Tidal 预刷新失败，保留旧 token:", err);
  }
};

// ── IPC 注册 ────────────────────────────────────────────────────────────────

export const registerTidalIpc = (): void => {
  // 启动期初始化 token 缓存（不阻塞 IPC 注册，不主动启动 callback server）
  void getTidalTokenSync();

  ipcMain.handle("tidal:startOauth", (): { authorizeUrl: string } => {
    const { authorizeUrl } = startOauthFlow();
    return { authorizeUrl };
  });

  // 用户取消登录时调用：清理 callback server，主动 reject 等待中的 completeOauth
  ipcMain.handle("tidal:cancelOauth", (): void => {
    cancelOauthFlow();
  });

  ipcMain.handle("tidal:completeOauth", async (): Promise<TidalCompleteResult> => {
    try {
      const tokenResp = await waitForCallback();
      // 用新拿到的 access_token 调 /users/me 拿 profile
      const tempPayload: TidalTokenPayload = {
        accessToken: tokenResp.access_token,
        refreshToken: tokenResp.refresh_token,
        expiresAt: Date.now() + tokenResp.expires_in * 1000,
        subscription: "unknown",
        nickname: "",
        userId: tokenResp.user_id,
      };
      const verifyResult = await verifyToken(tempPayload);
      const profile: TidalProfile = verifyResult.ok
        ? verifyResult.profile
        : { nickname: "Tidal User", subscription: "unknown" };

      // 落盘完整 token（含 profile 信息）
      const dir = path.dirname(TOKEN_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const state: PersistedTokenState = {
        encryptedAccessToken: encryptToken(tokenResp.access_token),
        encryptedRefreshToken: encryptToken(tokenResp.refresh_token),
        expiresAt: Date.now() + tokenResp.expires_in * 1000,
        subscription: profile.subscription,
        nickname: profile.nickname,
        userId: profile.userId,
      };
      atomicWriteSync(TOKEN_FILE, JSON.stringify(state, null, 2));
      invalidateCachedFile(TOKEN_FILE);
      tidalLog.info(
        `[ERR-12026-A] Tidal token 已加密落盘: nickname=${profile.nickname} subscription=${profile.subscription}`,
      );

      return { ok: true, profile };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tidalLog.warn(`[ERR-12022-A] Tidal OAuth 等待 callback 失败: ${message}`);
      // 失败时清理 session（关闭 callback server）
      cleanupSession();
      return { ok: false, error: message };
    }
  });

  ipcMain.handle(
    "tidal:setToken",
    (_e, payload: TidalTokenPayload): TidalOpResult => {
      try {
        const accessToken = (payload?.accessToken ?? "").trim();
        const refreshToken = (payload?.refreshToken ?? "").trim();
        if (!accessToken || !refreshToken) return { ok: false, error: "empty token" };
        const dir = path.dirname(TOKEN_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const state: PersistedTokenState = {
          encryptedAccessToken: encryptToken(accessToken),
          encryptedRefreshToken: encryptToken(refreshToken),
          expiresAt: payload.expiresAt ?? 0,
          subscription: payload.subscription ?? "unknown",
          nickname: payload.nickname ?? "",
          userId: payload.userId,
        };
        atomicWriteSync(TOKEN_FILE, JSON.stringify(state, null, 2));
        invalidateCachedFile(TOKEN_FILE);
        tidalLog.info(
          `[ERR-12026-A] Tidal token 已加密落盘: nickname=${state.nickname} subscription=${state.subscription}`,
        );
        return { ok: true };
      } catch (err) {
        tidalLog.error("[ERR-12027-A] 写入 tidal.json 失败:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("tidal:getToken", (): TidalTokenPayload | null => getTidalTokenSync());

  ipcMain.handle("tidal:clearToken", (): TidalOpResult => {
    try {
      if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
      invalidateCachedFile(TOKEN_FILE);
      // 同时清理可能残留的 OAuth session
      cancelOauthFlow();
      tidalLog.info("[ERR-12028-A] Tidal token 已清除");
      return { ok: true };
    } catch (err) {
      tidalLog.error("[ERR-12029-A] 删除 tidal.json 失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("tidal:fetchStatus", async (): Promise<TidalStatusResult> => {
    // 先尝试自动刷新快过期的 token
    await ensureFreshAccessToken();
    const token = getTidalTokenSync();
    if (!token) return { ok: false, error: "no token" };
    return verifyToken(token);
  });

  ipcMain.handle("tidal:refreshToken", async (): Promise<TidalOpResult> => {
    try {
      const token = getTidalTokenSync();
      if (!token?.refreshToken) {
        return { ok: false, error: "no refresh token" };
      }
      const tokenResp = await refreshAccessToken(token.refreshToken);
      persistRefreshedToken({
        accessToken: tokenResp.access_token,
        refreshToken: tokenResp.refresh_token || token.refreshToken,
        expiresAt: Date.now() + tokenResp.expires_in * 1000,
      });
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      tidalLog.error(`[ERR-12025-A] Tidal token 刷新失败: ${message}`);
      return { ok: false, error: message };
    }
  });

  // 下载一首歌到指定路径，用于本地频谱检测（验证是否掺水）
  ipcMain.handle(
    "tidal:downloadTrack",
    async (_e, trackId: string, outputPath: string): Promise<TidalDownloadResult> => {
      const tid = String(trackId ?? "").trim();
      const outPath = String(outputPath ?? "").trim();
      if (!tid) return { ok: false, error: "trackId required" };
      if (!outPath) return { ok: false, error: "outputPath required" };

      try {
        // 1. 调 song_url 拿 CDN 直链 + 元数据
        const urlResult = await callTidal("song_url", { trackId: tid });
        const url: string | undefined = urlResult?.url;
        const bitDepth: number | undefined = urlResult?.bitDepth;
        const samplingRate: number | undefined = urlResult?.samplingRate;
        if (!url) {
          tidalLog.warn(`[ERR-12033-A] Tidal 取流 URL 为空: trackId=${tid}`);
          return {
            ok: false,
            error: urlResult?.message || "no stream url (subscription tier may be insufficient)",
            bitDepth,
            samplingRate,
          };
        }
        // 根据文件扩展名推断 MIME（manifest 不一定带 mimeType 字段）
        const ext = path.extname(outPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".flac": "audio/flac",
          ".m4a": "audio/mp4",
          ".mp4": "audio/mp4",
          ".mp3": "audio/mpeg",
        };
        const mimeType = mimeMap[ext] ?? "audio/*";

        // 2. 父目录检查
        const dir = path.dirname(outPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // 3. overseasFetch 走代理下载音频流
        tidalLog.info(
          `[ERR-12026-A] Tidal 下载开始: trackId=${tid} → ${outPath} (bitDepth=${bitDepth ?? "?"} samplingRate=${samplingRate ?? "?"}kHz)`,
        );
        const resp = await overseasFetch(url, {
          method: "GET",
          headers: {
            "User-Agent": TIDAL_UA,
            Accept: mimeType,
          },
          signal: AbortSignal.timeout(120_000),
        });
        if (!resp.ok || !resp.body) {
          tidalLog.warn(`[ERR-12033-A] Tidal 下载失败 HTTP ${resp.status}: ${url}`);
          return {
            ok: false,
            error: `HTTP ${resp.status}`,
            bitDepth,
            samplingRate,
            mimeType,
          };
        }

        // 4. 流式写入磁盘（不一次性 buffer 到内存，避免大文件 OOM）
        const ws = fs.createWriteStream(outPath);
        // resp.body 是 Web ReadableStream；Node 22+ fetch 直接返回，无需转换
        const nodeStream = Readable.fromWeb(resp.body as unknown as import("stream/web").ReadableStream);
        await pipeline(nodeStream, ws);
        const stats = fs.statSync(outPath);

        tidalLog.info(
          `[ERR-12026-A] Tidal 下载完成: ${outPath} (size=${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
        );

        return {
          ok: true,
          path: outPath,
          sizeBytes: stats.size,
          bitDepth,
          samplingRate,
          mimeType,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        tidalLog.error(`[ERR-12033-A] Tidal 下载异常: trackId=${tid} → ${message}`);
        return { ok: false, error: message };
      }
    },
  );
};
