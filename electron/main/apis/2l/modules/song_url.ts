/**
 * 获取 2L 试听播放 URL
 *
 * 2L 是免费样品，URL 无签名、无时效，直接可播。
 * search 模块已把直链放进 song.hashes["2l-url"]，本模块直接透传返回。
 *
 * 取值优先级：
 * 1. params.hashes["2l-url"]   （search 返回的标准路径，与 kugou 多品质 hash 字典一致）
 * 2. params.url                （调用方直接传 URL 的兜底路径）
 * 3. params.trackId            （trackId 即 URL 的极简调用方，向后兼容）
 *
 * 2L 仅用于个人试听模式，禁止曲库收录：
 * 返回的 URL 仅用于流式试听，不可下载落盘或加入用户曲库。
 *
 * params:
 * - hashes   search 返回的 hash 字典（必填，含 "2l-url" 键）
 * - url      直链兜底（可选）
 * - trackId  极简调用方的 URL 兜底（可选）
 */

import { twoLLog } from "@main/utils/logger";
import type { TwoLModule } from "../core/types";

interface SongUrlResp {
  code: number;
  url: string;
  source: "2l";
  message?: string;
}

const TWO_L_URL_KEY = "2l-url";

/** 判断字符串是否为合法 http(s) URL（粗略：scheme + host） */
const isHttpUrl = (s: unknown): s is string =>
  typeof s === "string" && /^https?:\/\/[^\s]+$/i.test(s);

const song_url: TwoLModule = async (params) => {
  const { hashes, url, trackId } = params as {
    hashes?: Record<string, unknown>;
    url?: unknown;
    trackId?: unknown;
  };

  // 1. 优先从 hashes["2l-url"] 取（search 模块标准路径）
  const fromHashes = hashes?.[TWO_L_URL_KEY];
  if (isHttpUrl(fromHashes)) {
    twoLLog.info(`[ERR-14002-A] 2L 直链命中: url=${fromHashes.slice(0, 120)}`);
    return { code: 200, url: fromHashes, source: "2l" } satisfies SongUrlResp;
  }

  // 2. 兜底：params.url 直接传 URL
  if (isHttpUrl(url)) {
    twoLLog.info(`[ERR-14002-A] 2L 直链命中（params.url 兜底）: url=${url.slice(0, 120)}`);
    return { code: 200, url, source: "2l" } satisfies SongUrlResp;
  }

  // 3. 极简兜底：trackId 直接是 URL（向后兼容 scaffold 调用方）
  if (isHttpUrl(trackId)) {
    twoLLog.info(`[ERR-14002-A] 2L 直链命中（trackId 兜底）: url=${trackId.slice(0, 120)}`);
    return { code: 200, url: trackId, source: "2l" } satisfies SongUrlResp;
  }

  // 失败：所有路径均无有效 URL
  twoLLog.warn(
    `[ERR-14002-A] 2L 取流失败：hashes["${TWO_L_URL_KEY}"] / url / trackId 均无有效直链`,
    { hashes, url, trackId },
  );
  return {
    code: 200,
    url: "",
    source: "2l",
    message: "2L direct URL missing (personal trial mode only)",
  } satisfies SongUrlResp;
};

export default song_url;
