/**
 * Spotify 凭证持久化
 *
 * 设计参考 qqmusic / kugou / tidal：
 * - 凭证文件：{configDir}/spotify.json
 * - clientId / clientSecret / userAccessToken / userRefreshToken / browserCookie
 *   全部经 safeStorage 加密后落盘；不可用时回退 base64（仅本机可读，等价明文）
 * - userTokenExpireAt / browserTokenExpireAt 为 unix 毫秒时间戳，明文存便于刷新判断
 *
 * 注意：client_id / client_secret 不硬编码，由用户在设置中写入或留空。
 */

import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { spotifyLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import { readCachedJsonSync, invalidateCachedFile } from "@main/utils/cachedFileReader";

const STORAGE_FILE = path.join(configDir, "spotify.json");

/** 持久化结构 */
export interface PersistedSpotifyState {
  /** 加密后的 client_id（base64） */
  encryptedClientId?: string;
  /** 加密后的 client_secret（base64） */
  encryptedClientSecret?: string;
  /** 加密后的 PKCE access_token（base64） */
  encryptedUserAccessToken?: string;
  /** 加密后的 PKCE refresh_token（base64） */
  encryptedUserRefreshToken?: string;
  /** PKCE access_token 过期时间（unix 毫秒） */
  userTokenExpireAt?: number;
  /** 加密后的浏览器 cookie（sp_dc 等，base64） */
  encryptedBrowserCookie?: string;
}

/** 加密明文 */
const encrypt = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    spotifyLog.warn("系统安全存储不可用，Spotify 凭证将以 base64 形式明文落盘");
    return Buffer.from(plain, "utf-8").toString("base64");
  }
  return safeStorage.encryptString(plain).toString("base64");
};

/** 解密密文 */
const decrypt = (encrypted: string | undefined): string => {
  if (!encrypted) return "";
  try {
    const buf = Buffer.from(encrypted, "base64");
    if (!safeStorage.isEncryptionAvailable()) return buf.toString("utf-8");
    return safeStorage.decryptString(buf);
  } catch {
    return "";
  }
};

/** 同步读盘 + 解析（带内存缓存，mtime 失效） */
const readRaw = (): PersistedSpotifyState | null => {
  try {
    return readCachedJsonSync<PersistedSpotifyState>(STORAGE_FILE);
  } catch {
    return null;
  }
};

/** 写盘 + 失效缓存 */
const writeRaw = (state: PersistedSpotifyState): void => {
  try {
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    atomicWriteSync(STORAGE_FILE, JSON.stringify(state, null, 2));
    invalidateCachedFile(STORAGE_FILE);
  } catch (err) {
    spotifyLog.error("[spotify] 写入 spotify.json 失败:", err);
  }
};

/** 读取 client_id（未配置返回空字符串） */
export const getClientId = (): string => decrypt(readRaw()?.encryptedClientId);

/** 读取 client_secret（未配置返回空字符串） */
export const getClientSecret = (): string => decrypt(readRaw()?.encryptedClientSecret);

/** 写入 client_id / client_secret */
export const setClientCredentials = (clientId: string, clientSecret: string): void => {
  const raw = readRaw() ?? {};
  raw.encryptedClientId = encrypt(clientId ?? "");
  raw.encryptedClientSecret = encrypt(clientSecret ?? "");
  writeRaw(raw);
};

/** 读取 PKCE 用户 token（未登录返回 null） */
export const getUserToken = (): {
  accessToken: string;
  refreshToken: string;
  expireAt: number;
} | null => {
  const raw = readRaw();
  if (!raw) return null;
  const accessToken = decrypt(raw.encryptedUserAccessToken);
  const refreshToken = decrypt(raw.encryptedUserRefreshToken);
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    expireAt: raw.userTokenExpireAt ?? 0,
  };
};

/** 写入 PKCE 用户 token */
export const setUserToken = (token: {
  accessToken: string;
  refreshToken: string;
  expireAt: number;
}): void => {
  const raw = readRaw() ?? {};
  raw.encryptedUserAccessToken = encrypt(token.accessToken);
  raw.encryptedUserRefreshToken = encrypt(token.refreshToken);
  raw.userTokenExpireAt = token.expireAt;
  writeRaw(raw);
};

/** 清除 PKCE 用户 token */
export const clearUserToken = (): void => {
  const raw = readRaw() ?? {};
  raw.encryptedUserAccessToken = "";
  raw.encryptedUserRefreshToken = "";
  raw.userTokenExpireAt = 0;
  writeRaw(raw);
};

/** 读取浏览器 cookie（未登录返回 null） */
export const getBrowserCookie = (): string | null => {
  const raw = readRaw();
  if (!raw) return null;
  const cookie = decrypt(raw.encryptedBrowserCookie);
  return cookie || null;
};

/** 写入浏览器 cookie */
export const setBrowserCookie = (cookie: string): void => {
  const raw = readRaw() ?? {};
  raw.encryptedBrowserCookie = encrypt(cookie ?? "");
  writeRaw(raw);
};

/** 清除浏览器 cookie */
export const clearBrowserCookie = (): void => {
  const raw = readRaw() ?? {};
  raw.encryptedBrowserCookie = "";
  writeRaw(raw);
};

/** 清除全部 Spotify 凭证 */
export const clearAllSpotifyCredentials = (): void => {
  try {
    if (fs.existsSync(STORAGE_FILE)) fs.unlinkSync(STORAGE_FILE);
    invalidateCachedFile(STORAGE_FILE);
  } catch (err) {
    spotifyLog.error("[spotify] 删除 spotify.json 失败:", err);
  }
};
