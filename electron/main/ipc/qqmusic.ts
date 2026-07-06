/**
 * QQ 音乐账户 IPC
 *
 * - 凭证文件：{configDir}/qqmusic.json，整串 cookie 经 safeStorage 加密
 * - setCookie / getCookie / clearCookie：基础凭证管理
 * - fetchStatus：用 cookie 调 musicu.fcg 验证有效性，返回用户资料
 * - getQqCookieSync：同步读盘 + 解密，供 apis/qqmusic/core/request.ts 注入到请求头
 */

import fs from "node:fs";
import path from "node:path";
import { ipcMain, safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { qqmusicLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import { QM_API_URL, QM_HEADERS, getCommonParams } from "@main/apis/qqmusic/core/config";

const STORAGE_FILE = path.join(configDir, "qqmusic.json");

interface PersistedState {
  encryptedCookie: string;
}

/**
 * 从 cookie 字符串中提取 uin（去掉前导 o0）
 * @param cookie - 完整 cookie 字符串
 * @returns uin 字符串；提取失败返回 null
 */
const extractUin = (cookie: string): string | null => {
  const match = /uin\s*=\s*o?(\d+)/i.exec(cookie);
  return match ? match[1] : null;
};

/** 加密 cookie 字符串 */
const encryptCookie = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    qqmusicLog.warn("系统安全存储不可用，QQ 音乐 cookie 将以 base64 形式明文落盘");
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
export const getQqCookieSync = (): string | null => {
  try {
    if (!fs.existsSync(STORAGE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8")) as PersistedState;
    const plain = decryptCookie(raw.encryptedCookie ?? "");
    return plain || null;
  } catch {
    return null;
  }
};

/** 同步读盘 + 解密，提取 uin（未登录或读盘失败返回 null） */
export const getQqUinSync = (): string | null => {
  const cookie = getQqCookieSync();
  return cookie ? extractUin(cookie) : null;
};

interface FcgResp {
  code?: number;
  request?: { code?: number; data?: unknown };
}

/**
 * vkey 验证：带 cookie + uin 调一次取 purl，code === 0 视为登录态有效
 */
const verifyByVkey = async (
  cookie: string,
  uin: string,
): Promise<{ ok: boolean; error?: string }> => {
  try {
    const body = {
      comm: { ...getCommonParams(), uin },
      request: {
        module: "music.vkey.GetVkeyServer",
        method: "CgiGetVkey",
        param: {
          guid: "1008610010",
          songmid: ["001qvvgF38HVc4"],
          songtype: [0],
          uin,
          loginflag: 1,
          platform: "20",
          filename: [`M500001qvvgF38HVc4.mp3`],
        },
      },
    };
    const res = await fetch(QM_API_URL, {
      method: "POST",
      headers: { ...QM_HEADERS, Cookie: cookie },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as FcgResp;
    const outer = data.code ?? -1;
    const inner = data.request?.code ?? -1;
    if (outer !== 0 || inner !== 0) {
      return { ok: false, error: `QM verify failed: outer=${outer} inner=${inner}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

interface UserInfoData {
  /** 顶层 creator / nickname 在不同版本响应中位置不同，统一尝试解析 */
  creator?: { nickName?: string; nickname?: string };
  data?: {
    creator?: { nickName?: string; nickname?: string };
    nickName?: string;
    nickname?: string;
  };
  nickName?: string;
  nickname?: string;
}

/**
 * 调 musicu.fcg 取昵称
 *
 * 尝试多个已知模块（QQ 音乐 web 端登录态接口路径多次变更），
 * 任一返回 nickname 即采用；全部失败时返回 null 由上层兜底
 */
const fetchNickname = async (
  cookie: string,
  uin: string,
): Promise<{ nickname: string; vipType: number } | null> => {
  /** 候选 module/method，按已知接口顺序尝试 */
  const candidates: Array<{ module: string; method: string; param: Record<string, unknown> }> = [
    {
      module: "music.musicasset.songlistinfo",
      method: "GetSongListDetail",
      param: { disstid: 0, dirid: 0, song_num: 0, song_begin: 0, userinfo: 1 },
    },
    {
      module: "music.userdir.userdir",
      method: "GetUserDir",
      param: { hostUin: Number(uin), page: 1, num: 1, from: 1 },
    },
  ];

  for (const { module, method, param } of candidates) {
    try {
      const body = {
        comm: { ...getCommonParams(), uin },
        request: { module, method, param },
      };
      const res = await fetch(QM_API_URL, {
        method: "POST",
        headers: { ...QM_HEADERS, Cookie: cookie },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const data = (await res.json()) as FcgResp & UserInfoData;
      if (data.code !== 0 || data.request?.code !== 0) continue;
      const d = (data.request?.data ?? {}) as UserInfoData["data"];
      const nick =
        data.creator?.nickName ||
        data.creator?.nickname ||
        d?.creator?.nickName ||
        d?.creator?.nickname ||
        d?.nickName ||
        d?.nickname ||
        data.nickName ||
        data.nickname;
      if (nick) {
        return { nickname: nick, vipType: 0 };
      }
    } catch {
      // 单个候选失败不影响后续尝试
    }
  }
  return null;
};

/**
 * 用 cookie 调 musicu.fcg 验证登录态并尽量取到真实昵称
 *
 * 流程：vkey 验证 cookie → 取昵称接口；昵称取不到时回退 uin 末 4 位兜底
 */
const verifyCookie = async (
  cookie: string,
): Promise<{ ok: boolean; profile?: { nickname: string; vipType: number }; error?: string }> => {
  const uin = extractUin(cookie);
  if (!uin) return { ok: false, error: "missing uin in cookie" };

  const verify = await verifyByVkey(cookie, uin);
  if (!verify.ok) return { ok: false, error: verify.error };

  const info = await fetchNickname(cookie, uin);
  if (info) return { ok: true, profile: info };

  // 昵称无法从现有接口稳定取得，用 uin 末 4 位兜底显示
  const tail = uin.slice(-4);
  return { ok: true, profile: { nickname: `QQ用户${tail}`, vipType: 0 } };
};

export const registerQqmusicIpc = (): void => {
  ipcMain.handle(
    "qqmusic:setCookie",
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
        qqmusicLog.error("写入 qqmusic.json 失败:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("qqmusic:getCookie", (): string | null => getQqCookieSync());

  ipcMain.handle("qqmusic:clearCookie", (): { ok: true } | { ok: false; error: string } => {
    try {
      if (fs.existsSync(STORAGE_FILE)) fs.unlinkSync(STORAGE_FILE);
      return { ok: true };
    } catch (err) {
      qqmusicLog.error("删除 qqmusic.json 失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    "qqmusic:fetchStatus",
    async (): Promise<{
      ok: boolean;
      profile?: { nickname: string; vipType: number };
      error?: string;
    }> => {
      const cookie = getQqCookieSync();
      if (!cookie) return { ok: false, error: "no cookie" };
      return verifyCookie(cookie);
    },
  );
};
