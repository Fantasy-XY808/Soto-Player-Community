/**
 * Bilibili 凭证持久化
 *
 * 设计参考 qqmusic / kugou / tidal：
 * - 凭证文件：{configDir}/bilibili.json，整串 cookie 经 safeStorage 加密
 * - 用户登录后写入；apis/bilibili/core/request.ts 注入到请求头
 * - 未登录时回退到 BILI_ANON_COOKIE（buvid3=placeholder）匿名访问
 *
 * 关键 cookie：SESSDATA（登录态）+ bili_jct（CSRF）+ DedeUserID（用户 uid）
 */

import fs from "node:fs";
import path from "node:path";
import { safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { bilibiliLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import { readCachedJsonSync, invalidateCachedFile } from "@main/utils/cachedFileReader";

const STORAGE_FILE = path.join(configDir, "bilibili.json");

interface PersistedState {
  encryptedCookie: string;
}

/** 加密 cookie 字符串 */
const encryptCookie = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    bilibiliLog.warn("系统安全存储不可用，Bilibili cookie 将以 base64 形式明文落盘");
    return Buffer.from(plain, "utf-8").toString("base64");
  }
  return safeStorage.encryptString(plain).toString("base64");
};

/** 解密 cookie 字符串 */
const decryptCookie = (encrypted: string): string => {
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
 * 同步读盘 + 解密，返回明文 cookie 或 null
 *
 * 使用 readCachedJsonSync 内存缓存：每个网络请求都会调用本函数，
 * 缓存命中后仅 statSync 比对 mtime，避免高频 readFileSync + JSON.parse 阻塞事件循环。
 */
export const getBilibiliCookieSync = (): string | null => {
  try {
    const raw = readCachedJsonSync<PersistedState>(STORAGE_FILE);
    if (!raw) return null;
    const plain = decryptCookie(raw.encryptedCookie ?? "");
    return plain || null;
  } catch {
    return null;
  }
};

/** 写入 cookie 字符串（空字符串视为清除） */
export const persistBilibiliCookieInternal = (cookie: string): boolean => {
  try {
    const plain = (cookie ?? "").trim();
    if (!plain) return false;
    const dir = path.dirname(STORAGE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const payload: PersistedState = { encryptedCookie: encryptCookie(plain) };
    atomicWriteSync(STORAGE_FILE, JSON.stringify(payload, null, 2));
    invalidateCachedFile(STORAGE_FILE);
    return true;
  } catch (err) {
    bilibiliLog.error("写入 bilibili.json 失败:", err);
    return false;
  }
};

/** 删除凭证文件 */
export const clearBilibiliCookieInternal = (): boolean => {
  try {
    if (fs.existsSync(STORAGE_FILE)) fs.unlinkSync(STORAGE_FILE);
    invalidateCachedFile(STORAGE_FILE);
    return true;
  } catch (err) {
    bilibiliLog.error("删除 bilibili.json 失败:", err);
    return false;
  }
};
