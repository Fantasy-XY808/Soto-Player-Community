/**
 * Qobuz 账户 IPC
 *
 * 与 kugou 之不同：
 * - 凭证不是 cookie，而是 user_auth_token + 订阅等级 + app_secret 候选
 * - 凭证文件：{configDir}/qobuz.json，token 经 safeStorage 加密落盘
 * - app_secret 周期性被 Qobuz 黑名单 → 多候选 + 启动期 test_secret() 自动 fail-over
 * - setToken / getToken / clearToken：token 凭证管理
 * - fetchStatus：用 token 调 /user/login（带 token）验证，返回用户资料 + 订阅等级
 * - getQobuzTokenSync：同步读盘 + 解密，供 apis/qobuz/core/request.ts 注入 X-User-Auth-Token
 * - getActiveQobuzAppSecret：返回当前可用的 app_secret 候选（启动期已 test_secret 过滤）
 */

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ipcMain, safeStorage } from "electron";
import { writeFileSync as atomicWriteSync } from "atomically";
import { qobuzLog } from "@main/utils/logger";
import { configDir } from "@main/utils/paths";
import { readCachedJsonSync, invalidateCachedFile } from "@main/utils/cachedFileReader";
import { callQobuz } from "@main/apis/qobuz";
import { BUILTIN_APP_SECRETS, QOBUZ_API_BASE, QOBUZ_APP_ID, QOBUZ_UA } from "@main/apis/qobuz/core/config";
import { overseasFetch } from "@main/services/proxyDispatcher";
import type {
  QobuzAppSecretEntry,
  QobuzDownloadResult,
  QobuzProfile,
  QobuzSubscription,
  QobuzTokenPayload,
} from "@shared/types/qobuz";

const TOKEN_FILE = path.join(configDir, "qobuz.json");
const SECRETS_FILE = path.join(configDir, "qobuz-secrets.json");

/** /user/login 验证接口（用 token 走带鉴权的 login 校验登录态） */
const LOGIN_URL = (token: string) =>
  `${QOBUZ_API_BASE}/user/login?user_auth_token=${encodeURIComponent(token)}`;

interface PersistedTokenState {
  encryptedToken: string;
  /** 订阅等级（明文存，无需解密读取，便于拉流时直接判 streamable） */
  subscription: QobuzSubscription;
  nickname: string;
  userId?: number;
}

interface PersistedSecretsState {
  /** 用户自定义的额外 app_secret 候选（覆盖式追加到 BUILTIN_APP_SECRETS 之后） */
  userSecrets: QobuzAppSecretEntry[];
}

// ── token 加解密 ────────────────────────────────────────────────────────────

const encryptToken = (plain: string): string => {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    qobuzLog.warn("系统安全存储不可用，Qobuz token 将以 base64 形式明文落盘");
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
 * 供 apis/qobuz/core/request.ts 注入 X-User-Auth-Token 用。
 */
export const getQobuzTokenSync = (): QobuzTokenPayload | null => {
  try {
    const raw = readCachedJsonSync<PersistedTokenState>(TOKEN_FILE);
    if (!raw) return null;
    const userAuthToken = decryptToken(raw.encryptedToken ?? "");
    if (!userAuthToken) return null;
    return {
      userAuthToken,
      subscription: raw.subscription ?? "unknown",
      nickname: raw.nickname ?? "",
      userId: raw.userId,
    };
  } catch {
    return null;
  }
};

// ── app_secret 多候选 + 启动期 test_secret fail-over ──────────────────────────

/** 当前已通过 test_secret 验证的活跃 app_secret（启动期填充） */
let activeAppSecret: QobuzAppSecretEntry | null = null;
let testSecretDone = false;

/**
 * 读取用户自定义的额外 app_secret 候选列表
 *
 * 使用 readCachedJsonSync 内存缓存：allSecretCandidates 在 song_url 拉流时
 * 会被调用（401 fail-over 路径），缓存避免每次都 readFileSync + JSON.parse。
 */
const readUserSecretsSync = (): QobuzAppSecretEntry[] => {
  try {
    const raw = readCachedJsonSync<PersistedSecretsState>(SECRETS_FILE);
    if (!raw) return [];
    return Array.isArray(raw.userSecrets) ? raw.userSecrets : [];
  } catch {
    return [];
  }
};

/** 合并内置 + 用户自定义候选（用户优先） */
const allSecretCandidates = (): QobuzAppSecretEntry[] => {
  const user = readUserSecretsSync();
  // 用户自定义优先（用户已知当前有效 secret 时直接覆盖内置）
  const merged = [...user];
  for (const builtin of BUILTIN_APP_SECRETS) {
    if (!merged.some((m) => m.appSecret === builtin.appSecret)) {
      merged.push(builtin);
    }
  }
  return merged;
};

/**
 * test_secret 探针：调一次公开 endpoint 验证 secret 是否仍被 Qobuz 接受
 *
 * Qobuz 黑名单已知泄露 secret 时会返回 401 invalid signature。
 * 用 `/track/get?track_id=1957256`（公开 ID）+ 签名请求，看签名是否被服务端接受。
 *
 * 这里简化为：调 /track/get 不带签名，只看 secret 本身是否能拼出合法请求（轻量验证）。
 * 真实 test_secret 应该是拼一次 getFileUrl 签名请求，但那需要登录 token。
 * 启动期没 token → 改为延迟到首次 getFileUrl 调用时按需 fail-over（见 song_url 模块）。
 *
 * 本函数只做：候选存在性校验（避免空 secret），真实 fail-over 在 song_url 调用时按需切换。
 */
const testSecret = async (entry: QobuzAppSecretEntry): Promise<boolean> => {
  // 阶段 1 简化：只校验 secret 格式（32 位十六进制），真实有效性在 getFileUrl 调用时按需 fail-over
  // 完整 test_secret 需要 user_auth_token，但启动期没 token → 延迟到首次拉流时再验证
  const isHex32 = /^[0-9a-f]{32}$/i.test(entry.appSecret);
  if (!isHex32) {
    qobuzLog.warn(
      `[ERR-11021-A] app_secret 格式非法（非 32 位十六进制）: source=${entry.source}`,
    );
    return false;
  }
  return true;
};

/**
 * 启动期初始化：合并内置 + 用户候选，挑第一个通过校验的作为活跃 secret
 *
 * 不在此处做真实 test_secret（需要 token），改为：
 * 1. 启动期只做格式校验 + 选第一个格式合法的
 * 2. 真实 fail-over 在 song_url.fetchStreamUrl 调用时按需触发：当前 secret 拿 getFileUrl 401 → 切换下一个
 */
const initActiveAppSecret = async (): Promise<void> => {
  if (testSecretDone) return;
  testSecretDone = true;

  const candidates = allSecretCandidates();
  for (const entry of candidates) {
    if (await testSecret(entry)) {
      activeAppSecret = entry;
      qobuzLog.info(
        `[ERR-11022-A] Qobuz 活跃 app_secret 选定: source=${entry.source} appId=${entry.appId}`,
      );
      return;
    }
  }
  qobuzLog.warn(
    `[ERR-11023-A] Qobuz 无可用 app_secret（候选共 ${candidates.length} 个均未通过校验）`,
  );
};

/**
 * 返回当前活跃的 app_secret 候选
 *
 * 供 apis/qobuz/modules/song_url.ts 拼 getFileUrl 签名用。
 * 调用方拿到后应自行处理 401 失败 → 切换下一个候选的逻辑（见 song_url.fetchStreamUrl）。
 */
export const getActiveQobuzAppSecret = (): QobuzAppSecretEntry | null => {
  if (!testSecretDone) {
    // 同步路径兜底：异步初始化未完成时，直接返回内置第一个候选
    // 真实 test_secret 会延迟到 getFileUrl 调用时按需 fail-over
    return BUILTIN_APP_SECRETS[0] ?? null;
  }
  return activeAppSecret;
};

/**
 * 切换到下一个候选 secret（当前 secret 拿 401 时调用）
 *
 * @param failedSecret 上次失败的 secret（用于排除）
 * @returns 切换后的新活跃 secret；无可用候选返回 null
 */
export const rotateQobuzAppSecret = (failedSecret: string): QobuzAppSecretEntry | null => {
  const candidates = allSecretCandidates();
  const next = candidates.find((c) => c.appSecret !== failedSecret);
  if (next) {
    activeAppSecret = next;
    qobuzLog.warn(
      `[ERR-11024-A] Qobuz app_secret 切换: 剔除失败 secret 后 → source=${next.source}`,
    );
  } else {
    activeAppSecret = null;
    qobuzLog.error(
      `[ERR-11025-A] Qobuz app_secret 全部候选均已失败，无可用 secret`,
    );
  }
  return next ?? null;
};

// ── /user/login 验证 ──────────────────────────────────────────────────────────

interface QobuzLoginResp {
  user?: {
    id?: number;
    login?: string;
    email?: string;
    /** 登录成功后返回的 user_auth_token（32 位十六进制），后续 API 鉴权用 */
    user_auth_token?: string;
    /** 订阅信息 */
    subscription?: {
      plan?: string;
      /** "premium" / "sublime" / "free" 等内部代号 */
      status?: string;
    };
    credential?: {
      parameters?: unknown;
    };
  };
  /** 部分版本字段结构不同 */
  status?: string;
  code?: string;
  message?: string | null;
}

/** 把 Qobuz 订阅响应规范化为内部 QobuzSubscription 字面量 */
const normalizeSubscription = (raw: QobuzLoginResp): QobuzSubscription => {
  const plan = raw.user?.subscription?.plan ?? "";
  const status = raw.user?.subscription?.status ?? "";
  if (plan.includes("sublime") || status.includes("sublime")) return "studio_sublime";
  if (plan.includes("premier") || plan.includes("premium") || status.includes("premier")) {
    return "studio_premier";
  }
  // credential.parameters 为空 → free 账号无法 stream 完整曲目
  const hasStreamCred = !!raw.user?.credential?.parameters;
  if (!hasStreamCred) return "free";
  return "unknown";
};

/**
 * 用 user_auth_token 调 /user/login 验证登录态
 *
 * Qobuz 的 token 验证比较特殊：拿 token 调 /user/login?user_auth_token=xxx，
 * 200 返回 user 对象即视为有效；401 视为 token 失效。
 */
const verifyToken = async (
  token: string,
): Promise<{ ok: true; profile: QobuzProfile } | { ok: false; error: string }> => {
  try {
    const res = await overseasFetch(LOGIN_URL(token), {
      method: "GET",
      headers: {
        "User-Agent": QOBUZ_UA,
        "X-App-Id": QOBUZ_APP_ID,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status !== 200) return { ok: false, error: `Qobuz HTTP ${res.status}` };
    const body = (await res.json()) as QobuzLoginResp;
    if (body.status === "error" || !body.user) {
      return { ok: false, error: `Qobuz verify failed: code=${body.code ?? "?"}` };
    }
    const profile: QobuzProfile = {
      nickname: body.user.login ?? body.user.email ?? "Qobuz User",
      subscription: normalizeSubscription(body),
      userId: body.user.id,
    };
    return { ok: true, profile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

// ── IPC 注册 ────────────────────────────────────────────────────────────────

export const registerQobuzIpc = (): void => {
  // 启动期初始化 app_secret 候选（异步，不阻塞 IPC 注册）
  void initActiveAppSecret();

  ipcMain.handle(
    "qobuz:setToken",
    (_e, payload: QobuzTokenPayload): { ok: true } | { ok: false; error: string } => {
      try {
        const token = (payload?.userAuthToken ?? "").trim();
        if (!token) return { ok: false, error: "empty token" };
        const dir = path.dirname(TOKEN_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const state: PersistedTokenState = {
          encryptedToken: encryptToken(token),
          subscription: payload.subscription ?? "unknown",
          nickname: payload.nickname ?? "",
          userId: payload.userId,
        };
        atomicWriteSync(TOKEN_FILE, JSON.stringify(state, null, 2));
        invalidateCachedFile(TOKEN_FILE);
        qobuzLog.info(
          `[ERR-11026-A] Qobuz token 已加密落盘: nickname=${state.nickname} subscription=${state.subscription}`,
        );
        return { ok: true };
      } catch (err) {
        qobuzLog.error("[ERR-11027-A] 写入 qobuz.json 失败:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle("qobuz:getToken", (): QobuzTokenPayload | null => getQobuzTokenSync());

  ipcMain.handle("qobuz:clearToken", (): { ok: true } | { ok: false; error: string } => {
    try {
      if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
      invalidateCachedFile(TOKEN_FILE);
      qobuzLog.info("[ERR-11028-A] Qobuz token 已清除");
      return { ok: true };
    } catch (err) {
      qobuzLog.error("[ERR-11029-A] 删除 qobuz.json 失败:", err);
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("qobuz:fetchStatus", async (): Promise<
    { ok: true; profile: QobuzProfile } | { ok: false; error: string }
  > => {
    const token = getQobuzTokenSync();
    if (!token) return { ok: false, error: "no token" };
    return verifyToken(token.userAuthToken);
  });

  ipcMain.handle("qobuz:getAppSecrets", (): QobuzAppSecretEntry[] => {
    return allSecretCandidates();
  });

  ipcMain.handle(
    "qobuz:setAppSecrets",
    (_e, entries: QobuzAppSecretEntry[]): { ok: true } | { ok: false; error: string } => {
      try {
        const dir = path.dirname(SECRETS_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const state: PersistedSecretsState = {
          userSecrets: Array.isArray(entries) ? entries : [],
        };
        atomicWriteSync(SECRETS_FILE, JSON.stringify(state, null, 2));
        invalidateCachedFile(SECRETS_FILE);
        // 用户更新了 secret → 重置活跃候选，下次调用时重新挑
        activeAppSecret = null;
        testSecretDone = false;
        void initActiveAppSecret();
        qobuzLog.info(
          `[ERR-11030-A] Qobuz 用户自定义 app_secret 已落盘: count=${state.userSecrets.length}`,
        );
        return { ok: true };
      } catch (err) {
        qobuzLog.error("[ERR-11031-A] 写入 qobuz-secrets.json 失败:", err);
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  ipcMain.handle(
    "qobuz:login",
    async (
      _e,
      username: string,
      password: string,
    ): Promise<{ ok: true; profile: QobuzProfile } | { ok: false; error: string }> => {
      try {
        // 构造登录 URL：username/password 走 encodeURIComponent，避免特殊字符破坏 query
        // 注意：日志不打印完整 URL，避免密码泄露
        const loginUrl = `${QOBUZ_API_BASE}/user/login?username=${encodeURIComponent(
          username,
        )}&password=${encodeURIComponent(password)}`;

        // 海外 API 必须用 overseasFetch 走 Clash 代理，不能用 Node 原生 fetch
        const res = await overseasFetch(loginUrl, {
          method: "GET",
          headers: {
            "User-Agent": QOBUZ_UA,
            "X-App-Id": QOBUZ_APP_ID,
          },
          signal: AbortSignal.timeout(8000),
        });

        if (res.status !== 200) {
          qobuzLog.error(`[ERR-11033-A] Qobuz 登录 HTTP 错误: status=${res.status}`);
          return { ok: false, error: `Qobuz HTTP ${res.status}` };
        }

        const body = (await res.json()) as QobuzLoginResp;
        if (body.status === "error" || !body.user?.user_auth_token) {
          const errMsg = body.message ?? `code=${body.code ?? "?"}`;
          qobuzLog.warn(`[ERR-11034-A] Qobuz 登录失败: ${errMsg}`);
          // 401 用户名密码错误 / 其他业务错误
          if (body.code === "401" || /invalid|credentials/i.test(errMsg)) {
            return { ok: false, error: "用户名或密码错误" };
          }
          return { ok: false, error: `Qobuz login failed: ${errMsg}` };
        }

        // 提取 token + 规范化订阅等级
        const userAuthToken = body.user.user_auth_token;
        const subscription = normalizeSubscription(body);
        const nickname = body.user.login ?? body.user.email ?? "Qobuz User";
        const userId = body.user.id;

        // 落盘 token（复用 encryptToken + atomicWriteSync，token 仅主进程内部持有）
        const dir = path.dirname(TOKEN_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const state: PersistedTokenState = {
          encryptedToken: encryptToken(userAuthToken),
          subscription,
          nickname,
          userId,
        };
        atomicWriteSync(TOKEN_FILE, JSON.stringify(state, null, 2));
        invalidateCachedFile(TOKEN_FILE);

        qobuzLog.info(
          `[ERR-11035-A] Qobuz 用户名密码登录成功: nickname=${nickname} subscription=${subscription}`,
        );

        // 返回 profile（不返回 tokenPayload，与 QobuzApi.login 类型对齐；token 不外泄到渲染端）
        const profile: QobuzProfile = {
          nickname,
          subscription,
          userId,
        };
        return { ok: true, profile };
      } catch (err) {
        qobuzLog.error("[ERR-11036-A] Qobuz 登录异常:", err);
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // 下载一首歌到指定路径，用于本地频谱检测（验证是否掺水）
  ipcMain.handle(
    "qobuz:downloadTrack",
    async (
      _e,
      trackId: string,
      outputPath: string,
      formatId?: number,
    ): Promise<QobuzDownloadResult> => {
      const tid = String(trackId ?? "").trim();
      const outPath = String(outputPath ?? "").trim();
      if (!tid) return { ok: false, error: "trackId required" };
      if (!outPath) return { ok: false, error: "outputPath required" };

      try {
        // 1. 调 song_url 拿 CDN 直链 + 元数据
        const urlResult = await callQobuz("song_url", { trackId: tid, formatId });
        const url: string | undefined = urlResult?.url;
        const bitDepth: number | undefined = urlResult?.bitDepth;
        const samplingRate: number | undefined = urlResult?.samplingRate;
        const fmtId: number | undefined = urlResult?.formatId;
        if (!url) {
          qobuzLog.warn(`[ERR-11040-A] Qobuz 取流 URL 为空: trackId=${tid}`);
          return {
            ok: false,
            error: urlResult?.message || "no stream url (subscription tier may be insufficient)",
            bitDepth,
            samplingRate,
            formatId: fmtId,
          };
        }

        // 2. 父目录检查
        const dir = path.dirname(outPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // 3. 根据扩展名推断 MIME（preview 是 MP3，stream 是 FLAC）
        const ext = path.extname(outPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".flac": "audio/flac",
          ".m4a": "audio/mp4",
          ".mp4": "audio/mp4",
          ".mp3": "audio/mpeg",
        };
        const mimeType = mimeMap[ext] ?? "audio/*";

        // 4. overseasFetch 走代理下载音频流
        qobuzLog.info(
          `[ERR-11041-A] Qobuz 下载开始: trackId=${tid} → ${outPath} (fmt=${fmtId ?? "?"} bitDepth=${bitDepth ?? "?"} sr=${samplingRate ?? "?"}kHz)`,
        );
        const resp = await overseasFetch(url, {
          method: "GET",
          headers: {
            "User-Agent": QOBUZ_UA,
            Accept: mimeType,
          },
          signal: AbortSignal.timeout(120_000),
        });
        if (!resp.ok || !resp.body) {
          qobuzLog.warn(`[ERR-11040-A] Qobuz 下载失败 HTTP ${resp.status}: ${url}`);
          return {
            ok: false,
            error: `HTTP ${resp.status}`,
            bitDepth,
            samplingRate,
            formatId: fmtId,
            mimeType,
          };
        }

        // 5. 流式写入磁盘
        const ws = fs.createWriteStream(outPath);
        const nodeStream = Readable.fromWeb(resp.body as unknown as import("stream/web").ReadableStream);
        await pipeline(nodeStream, ws);
        const stats = fs.statSync(outPath);

        qobuzLog.info(
          `[ERR-11041-A] Qobuz 下载完成: ${outPath} (size=${(stats.size / 1024 / 1024).toFixed(2)} MB)`,
        );

        return {
          ok: true,
          path: outPath,
          sizeBytes: stats.size,
          bitDepth,
          samplingRate,
          formatId: fmtId,
          mimeType,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        qobuzLog.error(`[ERR-11040-A] Qobuz 下载异常: trackId=${tid} → ${message}`);
        return { ok: false, error: message };
      }
    },
  );
};
