/**
 * 获取 mora 播放 URL
 *
 * 接口：GET https://mora.jp/listenDownload?materialNo={materialNo}
 * 返回 JSON：{ listenUrl: "https://cf-priv.mora.jp/.../xxx.320.mp4?Policy=...&Signature=..." }
 *
 * 流程（基于实地抓包验证，2026-07-11）：
 * 1. 从 track.hashes["mora-materialNo"] 取出 materialNo（由 search.ts 透传）
 * 2. 调用 listenDownload 接口拿 JSON
 * 3. 返回 listenUrl —— 签名 CloudFront URL，扩展名 .mp4，AAC 320kbps in MP4 容器
 *
 * 关键点：
 * - listenUrl 有时效（约 24h，AWS CloudFront 签名 URL），不能预存到 hashes，必须每次播放时实时调用
 * - listenFlg=0 表示不可试听（部分曲目版权方禁用），直接返回空 URL
 * - 完整流 D 级不接入：mora 是下载商店，无流媒体能力
 *
 * 付费登录用户：若 getMoraTokenSync() 返回非空，日志提示
 * "已检测付费登录凭据，但 mora 完整流需购买后走 mora Downloader 客户端下载，本应用不接入完整流"
 *
 * params:
 * - hashes   搜索时透传的多品质 hash 字典，取 hashes["mora-materialNo"]
 * - trackId  mora track id（仅用于日志）
 */

import { MORA_API_BASE, MORA_LISTEN_PATH } from "../core/config";
import { getCurrentMoraCredentials, moraRequest } from "../core/request";
import { moraLog } from "@main/utils/logger";
import type { MoraModule } from "../core/types";

interface SongUrlParams {
  hashes?: unknown;
  trackId?: unknown;
}

interface SongUrlResult {
  code: number;
  url: string;
  source: "mora";
  message?: string;
}

/** listenDownload 接口返回的原始 JSON */
interface MoraListenResp {
  listenUrl?: string;
}

const song_url: MoraModule = async (params) => {
  const { hashes, trackId } = (params ?? {}) as SongUrlParams;

  // 付费登录用户提示：mora 完整流 D 级不接入
  const token = getCurrentMoraCredentials();
  if (token) {
    moraLog.info(
      `[ERR-14102-A] 已检测付费登录凭据，但 mora 完整流需购买后走 mora Downloader 客户端下载，本应用不接入完整流: trackId=${String(trackId ?? "-")} nickname=${token.nickname}`,
    );
  }

  // 1. 从 hashes 取 materialNo
  let materialNo = "";
  if (hashes && typeof hashes === "object") {
    const v = (hashes as Record<string, unknown>)["mora-materialNo"];
    if (typeof v === "string" && v) materialNo = v;
    else if (typeof v === "number") materialNo = String(v);
  }
  if (!materialNo) {
    moraLog.warn(`[ERR-14102-A] mora 取流未找到 materialNo: trackId=${String(trackId ?? "-")}`);
    return { code: 200, url: "", source: "mora" } satisfies SongUrlResult;
  }

  // 2. 调用 listenDownload 接口
  const url = `${MORA_API_BASE}${MORA_LISTEN_PATH}?materialNo=${encodeURIComponent(materialNo)}`;
  try {
    const resp = await moraRequest<MoraListenResp>(url);
    const listenUrl = resp?.listenUrl ?? "";
    if (!listenUrl) {
      moraLog.warn(
        `[ERR-14102-A] mora listenDownload 返回空 listenUrl: materialNo=${materialNo}`,
      );
      return { code: 200, url: "", source: "mora" } satisfies SongUrlResult;
    }

    moraLog.info(
      `[ERR-14102-A] mora 取流成功: materialNo=${materialNo} url=${listenUrl.slice(0, 80)}...`,
    );
    return { code: 200, url: listenUrl, source: "mora" } satisfies SongUrlResult;
  } catch (err) {
    moraLog.warn(`[ERR-14102-A] mora listenDownload 调用失败: materialNo=${materialNo}`, err);
    return { code: 200, url: "", source: "mora" } satisfies SongUrlResult;
  }
};

export default song_url;
