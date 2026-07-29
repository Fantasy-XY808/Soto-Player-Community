/**
 * ProStudioMasters 账户 IPC
 *
 * 与 Qobuz 之不同：
 * - 凭据是 session token（用户在 prostudiomasters.com 登录后从浏览器 DevTools 录取）
 *   - 可能是 Bearer JWT / Cookie 串 / 任意不透明字符串，应用不解析格式
 * - 凭据文件：{configDir}/prostudiomasters.json，token 经 safeStorage 加密落盘
 * - 签名算法未知 → 不内置 app_secret / 签名计算，仅做 HTTP 代理
 * - fetchStatus 不调远端 profile API（PSM 无公开 profile 接口），仅校验 token 存在性
 *   - 真实有效性在 song_url 调用 API 时按需校验
 * - getPsmTokenSync：同步读盘 + 解密，供 apis/prostudiomasters/core/request.ts 注入
 *
 * AGPL 合规：用户自带凭据访问自己付费的内容，应用只做 HTTP 代理
 */

import fs from "node:fs";
import path from "node:path";
import { ipcMain, safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { psmLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import { readCachedJsonSync, invalidateCachedFile } from "@main/utils/cachedFileReader";
import type {
  PsmTokenPayload,
  PsmStatusResult,
} from "@shared/types/prostudiomasters";

const TOKEN_FILE = path.join(configDir, "prostudiomasters.json");

interface PersistedTokenState {
  encryptedSessionToken: string;
  nickname: string;
  userId?: string;
}

// ── token 加解密 ────────────────────────────────────────────────────────────

const encryptSessionToken = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    psmLog.warn("系统安全存储不可用，PSM session token 将以 base64 形式明文落盘");
    return Buffer.from(plain, "utf-8").toString("base64");
  }
  return safeStorage.encryptString(plain).toString("base64");
};

const decryptSessionToken = (encrypted: string): string => {
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
 * 供 apis/prostudiomasters/core/request.ts 注入 Authorization/Cookie 用。
 */
export const getPsmTokenSync = (): PsmTokenPayload | null => {
  try {
    const raw = readCachedJsonSync<PersistedTokenState>(TOKEN_FILE);
    if (!raw) return null;
    const sessionToken = decryptSessionToken(raw.encryptedSessionToken ?? "");
    if (!sessionToken) return null;
    return {
      sessionToken,
      nickname: raw.nickname ?? "",
      userId: raw.userId,
    };
  } catch {
    return null;
  }
};

// ── IPC 注册 ────────────────────────────────────────────────────────────────

export const registerPsmIpc = (): void => {
  ipcMain.handle(
    "prostudiomasters:setToken",
    async (_e, payload: PsmTokenPayload): Promise<void> => {
      const token = (payload?.sessionToken ?? "").trim();
      if (!token) throw new Error("empty sessionToken");
      const dir = path.dirname(TOKEN_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const state: PersistedTokenState = {
        encryptedSessionToken: encryptSessionToken(token),
        nickname: payload.nickname ?? "",
        userId: payload.userId,
      };
      atomicWriteSync(TOKEN_FILE, JSON.stringify(state, null, 2));
      invalidateCachedFile(TOKEN_FILE);
      psmLog.info(
        `[ERR-14200-A] PSM session token 已加密落盘: nickname=${state.nickname}`,
      );
    },
  );

  ipcMain.handle(
    "prostudiomasters:getToken",
    (): PsmTokenPayload | null => getPsmTokenSync(),
  );

  ipcMain.handle(
    "prostudiomasters:clearToken",
    async (): Promise<void> => {
      if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
      invalidateCachedFile(TOKEN_FILE);
      psmLog.info("[ERR-14200-A] PSM session token 已清除");
    },
  );

  ipcMain.handle(
    "prostudiomasters:fetchStatus",
    async (): Promise<PsmStatusResult> => {
      // PSM 无公开 profile API，仅校验 token 存在性
      // 真实有效性在 song_url 调用 API 时按需校验（401/403 视为失效）
      const token = getPsmTokenSync();
      if (!token) return { ok: false, error: "no session token" };
      return {
        ok: true,
        nickname: token.nickname || "prostudiomasters 用户",
      };
    },
  );
};
