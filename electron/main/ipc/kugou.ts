/**
 * 酷狗音乐账户 IPC
 *
 * - 凭证文件：{configDir}/kugou.json，整串 cookie 经 safeStorage 加密
 * - setCookie / getCookie / clearCookie：基础凭证管理
 * - fetchStatus：用 cookie 调 y.kugou.com/v1/get_userinfo 验证，返回用户资料
 * - getKugouCookieSync：同步读盘 + 解密，供 apis/kugou/core/request.ts 注入到请求头
 */

import fs from "node:fs";
import path from "node:path";
import { ipcMain, safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { kugouLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";

const STORAGE_FILE = path.join(configDir, "kugou.json");

/** 酷狗用户信息校验接口 */
const USERINFO_URL = "https://y.kugou.com/v1/get_userinfo";

/** 浏览器伪装 UA，避免被风控判为脚本 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

interface PersistedState {
  encryptedCookie: string;
}

/** 加密 cookie 字符串 */
const encryptCookie = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    kugouLog.warn("系统安全存储不可用，酷狗 cookie 将以 base64 形式明文落盘");
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

/** 同步读盘 + 解密，返回明文 cookie 或 null（供 request.ts 注入请求头用） */
export const getKugouCookieSync = (): string | null => {
  try {
    if (!fs.existsSync(STORAGE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedState;
    const plain = decryptCookie(raw.encryptedCookie ?? "");
    return plain || null;
  } catch {
    return null;
  }
};

interface KgUserInfoResp {
  status?: number;
  err_code?: number;
  data?: {
    nickname?: string;
    nick_name?: string;
    username?: string;
    vip_type?: number;
    is_vip?: number;
  };
  /** 部分版本把用户字段直接挂在顶层 */
  nickname?: string;
  nick_name?: string;
  vip_type?: number;
  is_vip?: number;
}

/**
 * 用 cookie 调 y.kugou.com/v1/get_userinfo 验证登录态
 *
 * status === 1 视为登录成功；昵称 / VIP 字段名在不同版本差异较大，宽松解析
 */
const verifyCookie = async (
  cookie: string,
): Promise<{ ok: boolean; profile?: { nickname: string; vipType: number }; error?: string }> => {
  try {
    const res = await fetch(USERINFO_URL, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Referer: "https://y.kugou.com/",
        Cookie: cookie,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 200) return { ok: false, error: `KG HTTP ${res.status}` };
    const body = (await res.json()) as KgUserInfoResp;
    if (body.status !== 1 && body.err_code !== 0) {
      return { ok: false, error: `KG verify failed: status=${body.status ?? "?"}` };
    }
    const d = body.data ?? {};
    const nickname =
      d.nickname || d.nick_name || d.username || body.nickname || body.nick_name || "酷狗用户";
    const vipType = d.vip_type ?? d.is_vip ?? body.vip_type ?? body.is_vip ?? 0;
    return { ok: true, profile: { nickname, vipType: Number(vipType) || 0 } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

export const registerKugouIpc = (): void => {
  ipcMain.handle(
    "kugou:setCookie",
    (_e, cookie: string): { ok: true } | { ok: false; error: string } => {
      try {
        const plain = (cookie ?? "").trim();
        if (!plain) return { ok: false, error: "empty cookie" };
        const dir = path.dirname(STORAGE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const payload: PersistedState = { encryptedCookie: encryptCookie(plain) };
        atomicWriteSync(STORAGE_FILE, JSON.stringify(payload, null, 2));
        return { ok: true };
      } catch (err) {
        kugouLog.error("写入 kugou.json 失败:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("kugou:getCookie", (): string | null => getKugouCookieSync());

  ipcMain.handle("kugou:clearCookie", (): { ok: true } | { ok: false; error: string } => {
    try {
      if (fs.existsSync(STORAGE_FILE)) fs.unlinkSync(STORAGE_FILE);
      return { ok: true };
    } catch (err) {
      kugouLog.error("删除 kugou.json 失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    "kugou:fetchStatus",
    async (): Promise<{
      ok: boolean;
      profile?: { nickname: string; vipType: number };
      error?: string;
    }> => {
      const cookie = getKugouCookieSync();
      if (!cookie) return { ok: false, error: "no cookie" };
      return verifyCookie(cookie);
    },
  );
};
