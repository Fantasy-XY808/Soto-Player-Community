/**
 * 获取 Tidal 播放 URL
 *
 * 端点：GET /tracks/{id}/playbackinfopostpaywall?playbackmode=STREAMING&assetpresentation=FULL
 * 需 Authorization: Bearer ${access_token}（核心 request 层自动注入）
 *
 * 返回 { manifestMimeType, manifest }：
 * - manifest 是 base64 编码的 JSON 字符串（不是直接的 URL）
 * - 解码后取 url 字段（CDN 直链，有时效）
 * - manifest JSON 含 mimeType（如 audio/flac）+ url + codecs / sampleRate / bitDepth
 *
 * 订阅等级与音质：
 * - hifi: 16bit/44.1kHz FLAC
 * - hifi_plus: 24bit/96kHz/192kHz MQA-FLAC（需订阅 HIFI_PLUS 才返回 24bit manifest）
 *
 * 401 自动刷新由 core/request.ts 的 tidalRequest 统一处理（autoRefresh 默认 true），
 * 本模块无需重复实现重试逻辑。
 *
 * params:
 * - trackId   Tidal track id（必填）
 * - quality   hifi（默认）/ hifi_plus；不在服务端 clamp，让用户显式指定
 */

import { TIDAL_API_BASE } from "../core/config";
import {
  TidalForbiddenError,
  tidalRequest,
} from "../core/request";
import { tidalLog } from "@main/utils/logger";
import type { TidalModule } from "../core/types";

interface TidalPlaybackInfoResp {
  /** manifest 的 MIME 类型，如 "application/vnd.tidal.vnd+json" 或 "audio/flac" */
  manifestMimeType?: string;
  /** base64 编码的 manifest JSON 字符串 */
  manifest?: string;
  /** 当前 stream 类型（如 "TRACK"） */
  trackMode?: string;
}

/** manifest 解码后的结构 */
interface TidalManifest {
  /** MIME 类型（如 "audio/flac" / "audio/mqa"） */
  mimeType?: string;
  /** CDN 直链（有时效） */
  url?: string;
  codecs?: string;
  /** 采样率（kHz，如 44.1 / 96 / 192） */
  sampleRate?: number;
  /** 位深（16 / 24） */
  bitDepth?: number;
}

interface SongUrlResult {
  code: number;
  url: string;
  source?: "stream" | "none";
  bitDepth?: number;
  samplingRate?: number;
  message?: string;
}

/**
 * 解码 base64 manifest 为 JSON
 *
 * Tidal 的 manifest 是 base64 编码的 JSON 字符串（可能是标准 base64 或 base64url）。
 */
const decodeManifest = (encoded: string): TidalManifest | null => {
  try {
    // 兼容 base64url：把 - 换成 +，_ 换成 /，补齐 = 填充
    let normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = normalized.length % 4;
    if (pad === 2) normalized += "==";
    else if (pad === 3) normalized += "=";

    const json = Buffer.from(normalized, "base64").toString("utf-8");
    return JSON.parse(json) as TidalManifest;
  } catch (err) {
    tidalLog.warn(
      `[ERR-12005-A] Tidal manifest 解码失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
};

const song_url: TidalModule = async (params) => {
  const trackId = String(params.trackId ?? "").trim();
  if (!trackId) return { code: 400, url: "", message: "trackId required" } satisfies SongUrlResult;

  const url =
    `${TIDAL_API_BASE}/tracks/${encodeURIComponent(trackId)}` +
    `/playbackinfopostpaywall?playbackmode=STREAMING&assetpresentation=FULL`;

  try {
    const body = await tidalRequest<TidalPlaybackInfoResp>(url);

    if (!body.manifest) {
      tidalLog.warn(`[ERR-12005-A] Tidal playbackinfo manifest 为空: trackId=${trackId}`);
      return { code: 200, url: "", source: "none" } satisfies SongUrlResult;
    }

    const manifest = decodeManifest(body.manifest);
    if (!manifest?.url) {
      tidalLog.warn(`[ERR-12005-A] Tidal manifest 解析失败或无 url: trackId=${trackId}`);
      return { code: 200, url: "", source: "none" } satisfies SongUrlResult;
    }

    tidalLog.info(
      `[ERR-12003-A] Tidal 取流成功: trackId=${trackId} mimeType=${manifest.mimeType ?? "?"} ` +
        `bitDepth=${manifest.bitDepth ?? "?"} sr=${manifest.sampleRate ?? "?"}`,
    );
    return {
      code: 200,
      url: manifest.url,
      source: "stream",
      bitDepth: manifest.bitDepth,
      samplingRate: manifest.sampleRate,
    } satisfies SongUrlResult;
  } catch (err) {
    if (err instanceof TidalForbiddenError) {
      tidalLog.warn(`[ERR-12032-A] Tidal 取流 403 订阅等级不足: trackId=${trackId}`);
    } else {
      // 401 已由 tidalRequest 自动刷新重试；若仍抛出，说明 refresh 也失败
      tidalLog.warn(`[ERR-12004-A] Tidal 取流失败: trackId=${trackId}`, err);
    }
    return { code: 200, url: "", source: "none" } satisfies SongUrlResult;
  }
};

export default song_url;
