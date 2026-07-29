/**
 * 获取 Qobuz 播放 URL
 *
 * 阶段 1（MVP）：未登录 → 调 /track/get?track_id={id} 拿 preview URL（30s MP3 公开）
 * 阶段 2（完整）：登录态 → 调 /track/getFileUrl 用签名拿 24bit/192kHz FLAC
 *
 * 签名端点 /track/getFileUrl 需要：
 * - X-App-Id header
 * - X-User-Auth-Token header（登录后获得）
 * - request_sig query 参数（MD5 签名，多 app_secret 候选 + test_secret 自动 fail-over）
 * - request_ts query 参数（unix 时间戳）
 *
 * Free 账号 credential.parameters 为空 → 服务端拒绝 stream，必须回落 preview
 *
 * params:
 * - trackId    Qobuz track id（必填）
 * - formatId   优先尝试的 format_id（5/6/7/27），默认按订阅等级自动选
 */

import { QOBUZ_API_BASE, QobuzFormatId } from "../core/config";
import { qobuzRequest, signQobuzRequest, getCurrentQobuzCredentials } from "../core/request";
import { getActiveQobuzAppSecret, rotateQobuzAppSecret } from "@main/ipc/qobuz";
import { qobuzLog } from "@main/utils/logger";
import type { QobuzModule } from "../core/types";

interface QobuzTrackGetResp {
  track?: {
    id?: number;
    title?: string;
    previewable?: boolean;
    preview_url?: string;
    streamable?: boolean;
    maximum_bit_depth?: number;
    maximum_sampling_rate?: number;
  };
}

interface QobuzFileUrlResp {
  url?: string;
  /** 何时过期（unix 时间戳，秒） */
  expires_at?: number;
  format_id?: number;
  mime_type?: string;
  sampling_rate?: number;
  bit_depth?: number;
}

/** /track/get 拿 30s preview URL（公开，无鉴权） */
const fetchPreviewUrl = async (trackId: string): Promise<string> => {
  const url = `${QOBUZ_API_BASE}/track/get?track_id=${encodeURIComponent(trackId)}`;
  const body = await qobuzRequest<QobuzTrackGetResp>(url);
  const preview = body.track?.preview_url ?? "";
  if (preview) {
    qobuzLog.info(
      `[ERR-11003-A] Qobuz preview 命中: trackId=${trackId} → ${preview.slice(0, 80)}...`,
    );
  } else {
    qobuzLog.warn(`[ERR-11004-A] Qobuz preview 为空: trackId=${trackId}`);
  }
  return preview;
};

/**
 * /track/getFileUrl 拉真 Hi-Res 流（需订阅 + 签名）
 *
 * 当 Qobuz 返回 401 / "invalid signature" 时自动切换到下一个 app_secret 候选重试，
 * 直至候选耗尽。这样 app_secret 周期性被 Qobuz 黑名单时无需用户介入即可恢复。
 *
 * @param trackId       Qobuz track id
 * @param formatId      目标 format_id（5/6/7/27）
 * @param userAuthToken 用户 user_auth_token
 * @returns 流 URL；失败返回 null
 */
const fetchStreamUrl = async (
  trackId: string,
  formatId: number,
  userAuthToken: string,
): Promise<{ url: string; formatId: number; bitDepth?: number; samplingRate?: number } | null> => {
  // 最多遍历所有候选 secret，遇到 401 自动切换下一个
  const triedSecrets = new Set<string>();
  let currentSecret = getActiveQobuzAppSecret();

  while (currentSecret) {
    if (triedSecrets.has(currentSecret.appSecret)) {
      // 防御性：理论上 rotateQobuzAppSecret 不会返回已试过的，但兜底
      break;
    }
    triedSecrets.add(currentSecret.appSecret);

    const unixTs = Math.floor(Date.now() / 1000);
    const endpoint = "trackgetFileUrl";
    const sigParams: Record<string, string | number> = {
      format_id: formatId,
      intent: "stream",
      track_id: trackId,
      request_ts: unixTs,
    };
    const requestSig = signQobuzRequest(endpoint, sigParams, unixTs, currentSecret.appSecret);

    const url =
      `${QOBUZ_API_BASE}/track/getFileUrl` +
      `?track_id=${encodeURIComponent(trackId)}` +
      `&format_id=${formatId}` +
      `&intent=stream` +
      `&request_ts=${unixTs}` +
      `&request_sig=${encodeURIComponent(requestSig)}`;

    try {
      const body = await qobuzRequest<QobuzFileUrlResp>(url, {
        headers: { "X-User-Auth-Token": userAuthToken },
      });
      if (body.url) {
        qobuzLog.info(
          `[ERR-11006-A] Qobuz getFileUrl 成功: trackId=${trackId} format=${formatId} ` +
            `bitDepth=${body.bit_depth ?? "?"} sr=${body.sampling_rate ?? "?"} secret=${currentSecret.source}`,
        );
        return {
          url: body.url,
          formatId,
          bitDepth: body.bit_depth,
          samplingRate: body.sampling_rate,
        };
      }
      qobuzLog.warn(
        `[ERR-11007-A] Qobuz getFileUrl 返回空 url: trackId=${trackId} format=${formatId} secret=${currentSecret.source}`,
      );
      // 空 url 通常是订阅不支持该 format，不是 secret 问题，不切换
      return null;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // 401 / "invalid signature" → secret 可能被 Qobuz 黑名单，切换下一个候选重试
      const isSignatureError = /401|invalid\s*signature|signature/i.test(errMsg);
      if (isSignatureError) {
        qobuzLog.warn(
          `[ERR-11008-A] Qobuz getFileUrl 签名失败，切换 secret 重试: trackId=${trackId} ` +
            `failed=${currentSecret.source} reason=${errMsg}`,
        );
        const nextSecret = rotateQobuzAppSecret(currentSecret.appSecret);
        if (nextSecret && !triedSecrets.has(nextSecret.appSecret)) {
          currentSecret = nextSecret;
          continue;
        }
        return null;
      }
      // 非 401 错误（如 403/404/网络异常）不切换 secret，直接返回
      qobuzLog.warn(
        `[ERR-11008-A] Qobuz getFileUrl 失败（非签名问题）: trackId=${trackId} format=${formatId} reason=${errMsg}`,
      );
      return null;
    }
  }

  qobuzLog.warn(`[ERR-11005-A] Qobuz 无可用 app_secret 或全部候选已失败: trackId=${trackId}`);
  return null;
};

/**
 * 按订阅等级 + 可用音质元数据派生候选 format_id 优先级
 *
 * - studio_premier / studio_sublime：优先 27 → 7 → 6 → 5
 * - free：直接跳过 getFileUrl，回落 preview
 */
const preferredFormatIds = (subscription: string): number[] => {
  if (subscription === "studio_premier" || subscription === "studio_sublime") {
    return [
      QobuzFormatId.FLAC_24BIT_192K,
      QobuzFormatId.FLAC_24BIT_96K,
      QobuzFormatId.FLAC_16BIT,
      QobuzFormatId.MP3_320,
    ];
  }
  return [];
};

const song_url: QobuzModule = async (params) => {
  const trackId = String(params.trackId ?? "").trim();
  if (!trackId) return { code: 400, url: "", message: "trackId required" };

  // 优先尝试真·Hi-Res（需登录 + 付费订阅）
  const creds = getCurrentQobuzCredentials();
  if (creds && creds.subscription !== "free" && creds.subscription !== "unknown") {
    const formats = preferredFormatIds(creds.subscription);
    for (const fmt of formats) {
      const result = await fetchStreamUrl(trackId, fmt, creds.userAuthToken);
      if (result?.url) {
        return {
          code: 200,
          url: result.url,
          formatId: result.formatId,
          bitDepth: result.bitDepth,
          samplingRate: result.samplingRate,
          source: "stream",
        };
      }
    }
    qobuzLog.warn(
      `[ERR-11009-A] Qobuz getFileUrl 全部 format 失败，回落 preview: trackId=${trackId}`,
    );
  }

  // 回落 30s preview（无鉴权，公开 MP3）
  try {
    const preview = await fetchPreviewUrl(trackId);
    if (preview) {
      return {
        code: 200,
        url: preview,
        formatId: QobuzFormatId.MP3_320,
        source: "preview",
        preview: true,
      };
    }
  } catch (err) {
    qobuzLog.warn(`[ERR-11010-A] Qobuz preview 拉取异常: trackId=${trackId}`, err);
  }

  qobuzLog.warn(`[ERR-11011-A] Qobuz song_url 全部失败: trackId=${trackId}`);
  return { code: 200, url: "", source: "none" };
};

export default song_url;
