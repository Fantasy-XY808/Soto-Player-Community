/**
 * 获取 ProStudioMasters 播放 URL
 *
 * 双路径策略：
 *
 * 阶段 1（付费登录用户，HTML 抓取 + 凭据注入）：
 * - 若 getPsmTokenSync() 返回非空，抓 track 页 HTML 并注入凭据
 * - 解析 <audio>/<source>/data-* 等公开标记，若 PSM 网页登录态下
 *   展示完整 Hi-Res 流直链则自动捕获
 * - PSM 完整流 API 端点 URL 未公开，本模块不内置盲试循环
 *
 * 阶段 2（未登录 / 阶段 1 失败 / free 账号）：
 * - 从 params.hashes["psm-preview"] 取 2 分钟 MP3 试听直链
 * - 直接返回 { code: 200, url, source: "prostudiomasters" }
 * - 试听 MP3 公开可匿名
 *
 * 错误码：[ERR-14202-A]（取流失败 / 回落 preview）
 *
 * params:
 * - trackId  ProStudioMasters track id（必填）
 * - hashes   搜索时附带的 preview 直链（{ "psm-preview": url }）
 */

import { psmLog } from "@main/utils/logger";
import { PSM_WEB_BASE } from "../core/config";
import { psmRequestText, getCurrentPsmCredentials } from "../core/request";
import type { PsmModule } from "../core/types";

interface PsmSongUrlResult {
  code: number;
  url: string;
  source: "prostudiomasters";
  message?: string;
}

/** preview MP3 直链抓取正则（覆盖三种常见挂载点） */
const PSM_PREVIEW_RE = /data-preview-url="([^"]+)"/i;
const PSM_AUDIO_RE = /<audio[^>]+src="([^"]+)"/i;
const PSM_OGAUDIO_RE = /<source[^>]+src="([^"]+\.(?:mp3|m4a|flac)[^"]*)"/i;
/** 完整流直链抓取正则（登录态下 PSM 网页可能渲染的下载/播放链接） */
const PSM_FULLSTREAM_RE = /data-(?:stream|download|flac)-url="([^"]+\.(?:flac|wav|m4a)[^"]*)"/i;

const isHttpUrl = (s: string | null | undefined): boolean => {
  if (!s) return false;
  return /^https?:\/\//i.test(s);
};

/**
 * 阶段 1：付费登录用户抓 track 页 HTML 提取流直链
 *
 * 注入凭据后抓 https://www.prostudiomasters.com/track/{trackId}，
 * 依次尝试完整流正则 → preview 正则，命中即返回。
 */
const fetchStreamFromHtml = async (trackId: string): Promise<string> => {
  const creds = getCurrentPsmCredentials();
  if (!creds) return "";

  try {
    const trackUrl = `${PSM_WEB_BASE}/track/${encodeURIComponent(trackId)}`;
    const headers: Record<string, string> = {};
    // 凭据形式：Bearer token（Authorization）或 Cookie 字符串
    if (/^Bearer\s+\S+/i.test(creds.sessionToken)) {
      headers.Authorization = creds.sessionToken;
    } else {
      headers.Cookie = creds.sessionToken;
    }

    const html = await psmRequestText(trackUrl, { headers });

    // 优先尝试完整流直链（登录态下才可能出现）
    const fullMatch = html.match(PSM_FULLSTREAM_RE);
    if (fullMatch && isHttpUrl(fullMatch[1])) {
      psmLog.info(
        `[ERR-14202-A] PSM 完整流命中(HTML data-stream-url): trackId=${trackId} → ${fullMatch[1].slice(0, 80)}...`,
      );
      return fullMatch[1];
    }

    // 回落 preview MP3（公开 2 分钟试听）
    const previewMatch =
      html.match(PSM_PREVIEW_RE) ?? html.match(PSM_AUDIO_RE) ?? html.match(PSM_OGAUDIO_RE);
    if (previewMatch && isHttpUrl(previewMatch[1])) {
      psmLog.info(
        `[ERR-14202-A] PSM preview 命中(HTML): trackId=${trackId} → ${previewMatch[1].slice(0, 80)}...`,
      );
      return previewMatch[1];
    }

    psmLog.warn(
      `[ERR-14202-A] PSM HTML 未匹配到任何流直链: trackId=${trackId}（HTML ${html.length} 字节）`,
    );
    return "";
  } catch (err) {
    psmLog.warn(
      `[ERR-14202-A] PSM HTML 抓取失败: trackId=${trackId} reason=${err instanceof Error ? err.message : String(err)}`,
    );
    return "";
  }
};

const song_url: PsmModule = async (params) => {
  const trackId = String(params.trackId ?? "").trim();
  if (!trackId) {
    return {
      code: 200,
      url: "",
      source: "prostudiomasters",
      message: "trackId required",
    } satisfies PsmSongUrlResult;
  }

  const hashes = (params.hashes ?? {}) as Record<string, string>;

  // 阶段 1：付费登录用户抓 track 页 HTML
  const htmlUrl = await fetchStreamFromHtml(trackId);
  if (htmlUrl) {
    return {
      code: 200,
      url: htmlUrl,
      source: "prostudiomasters",
    } satisfies PsmSongUrlResult;
  }

  // 阶段 2：回落 2 分钟 MP3 试听（公开可匿名）
  const previewUrl = hashes["psm-preview"] ?? "";
  if (previewUrl) {
    psmLog.info(
      `[ERR-14202-A] PSM 回落 preview hash: trackId=${trackId} → ${previewUrl.slice(0, 80)}...`,
    );
    return {
      code: 200,
      url: previewUrl,
      source: "prostudiomasters",
    } satisfies PsmSongUrlResult;
  }

  psmLog.warn(`[ERR-14202-A] PSM song_url 全部失败: trackId=${trackId}`);
  return {
    code: 200,
    url: "",
    source: "prostudiomasters",
  } satisfies PsmSongUrlResult;
};

export default song_url;
