/**
 * mora 账户 IPC
 *
 * 与 qobuz 之不同：
 * - 凭证是 cookie 字符串（不是 user_auth_token + app_secret 签名）
 * - 凭证文件：{configDir}/mora.json，cookie 经 safeStorage 加密落盘
 * - mora 无 profile API，fetchStatus 仅校验 cookie 文件存在性 + 解密成功
 * - getMoraTokenSync：同步读盘 + 解密，供 apis/mora/core/request.ts 注入 Cookie header
 *
 * 试听路径免登录：所有用户都能听 AAC 试听（不走 cookie 鉴权）
 * 付费登录可选增强：用户配置 cookie 后可访问购买曲目元数据（完整流仍不接入，D 级）
 *
 * 错误码段位：14XXX-A
 */

import fs from "node:fs";
import path from "node:path";
import { ipcMain, safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { moraLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import { readCachedJsonSync, invalidateCachedFile } from "@main/utils/cachedFileReader";
import type {
  MoraOpResult,
  MoraStatusResult,
  MoraTokenPayload,
} from "@shared/types/mora";

const MORA_TOKEN_FILE = path.join(configDir, "mora.json");

interface PersistedTokenState {
  /** safeStorage 加密后的 cookie（base64） */
  encryptedCookie: string;
  /** 昵称（明文存，无需解密读取） */
  nickname: string;
  /** 用户 ID（mora 不暴露，可选） */
  userId?: string;
}

// ── cookie 加解密 ────────────────────────────────────────────────────────────

const encryptCookie = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    moraLog.warn("系统安全存储不可用，mora cookie 将以 base64 形式明文落盘");
    return Buffer.from(plain, "utf-8").toString("base64");
  }
  return safeStorage.encryptString(plain).toString("base64");
};

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
 * 同步读盘 + 解密，返回完整 token payload 或 null
 *
 * 使用 readCachedJsonSync 内存缓存：每个网络请求都会调用本函数，
 * 缓存命中后仅 statSync 比对 mtime，避免高频 readFileSync + JSON.parse 阻塞事件循环。
 * 供 apis/mora/core/request.ts 注入 Cookie header 用。
 */
export const getMoraTokenSync = (): MoraTokenPayload | null => {
  try {
    const raw = readCachedJsonSync<PersistedTokenState>(MORA_TOKEN_FILE);
    if (!raw) return null;
    const cookie = decryptCookie(raw.encryptedCookie ?? "");
    if (!cookie) return null;
    return {
      cookie,
      nickname: raw.nickname ?? "",
      userId: raw.userId,
    };
  } catch {
    return null;
  }
};

// ── IPC 注册 ────────────────────────────────────────────────────────────────

export const registerMoraIpc = (): void => {
  ipcMain.handle(
    "mora:setToken",
    (_e, payload: MoraTokenPayload): MoraOpResult => {
      try {
        const cookie = (payload?.cookie ?? "").trim();
        if (!cookie) return { ok: false, error: "empty cookie" };
        const dir = path.dirname(MORA_TOKEN_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const state: PersistedTokenState = {
          encryptedCookie: encryptCookie(cookie),
          nickname: payload.nickname ?? "",
          userId: payload.userId,
        };
        atomicWriteSync(MORA_TOKEN_FILE, JSON.stringify(state, null, 2));
        invalidateCachedFile(MORA_TOKEN_FILE);
        moraLog.info(
          `[ERR-14100-A] mora cookie 已加密落盘: nickname=${state.nickname}`,
        );
        return { ok: true };
      } catch (err) {
        moraLog.error("[ERR-14100-A] 写入 mora.json 失败:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("mora:getToken", (): MoraTokenPayload | null => getMoraTokenSync());

  ipcMain.handle("mora:clearToken", (): MoraOpResult => {
    try {
      if (fs.existsSync(MORA_TOKEN_FILE)) fs.unlinkSync(MORA_TOKEN_FILE);
      invalidateCachedFile(MORA_TOKEN_FILE);
      moraLog.info("[ERR-14100-A] mora cookie 已清除");
      return { ok: true };
    } catch (err) {
      moraLog.error("[ERR-14100-A] 删除 mora.json 失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  /**
   * mora 无 profile API，仅校验 cookie 文件存在性 + 解密成功
   *
   * 校验通过返回 `{ ok: true, nickname }`；否则返回 `{ ok: false, error }`
   */
  ipcMain.handle("mora:fetchStatus", (): MoraStatusResult => {
    const token = getMoraTokenSync();
    if (!token) return { ok: false, error: "no cookie" };
    return { ok: true, nickname: token.nickname || "mora 用户" };
  });
};
