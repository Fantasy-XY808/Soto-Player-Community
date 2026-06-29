/**
 * 获取 QQ 音乐播放 URL（vkey 接口）
 *
 * 协议：u.y.qq.com/cgi-bin/musicu.fcg → music.vkey.GetVkeyServer / CgiGetVkey
 * 匿名态可拿 128k mp3；VIP 高品质需要 cookie，本项目不接入登录态故仅给 128k
 *
 * params:
 * - mid  songmid（必填），例如 "001qvvgF38HVc4"
 *
 * 返回：
 * - code 200 + url：可播放的 http(s) 链接
 * - code 200 + url "":版权 / VIP 限制，purl 为空
 * - code 4xx/5xx：请求失败
 */

import { qqmusicLog } from "@main/utils/logger";
import { qmRequest } from "../core/request";
import type { QMModule } from "../core/types";

interface VkeyInfo {
  purl?: string;
}

interface VkeyResp {
  midurlinfo?: VkeyInfo[];
  sip?: string[];
}

/**
 * 尝试单个 filename 模板拿 purl
 *
 * @param mid        songmid
 * @param filename   形如 M500${mid}.mp3，前缀决定码率：M500=128k mp3 / M800=320k mp3 / C600=128k m4a
 * @returns purl（空字符串表示服务端拒绝或无权限）
 */
const fetchPurl = async (mid: string, filename: string): Promise<{ purl: string; sip?: string }> => {
  const data = await qmRequest<VkeyResp>("music.vkey.GetVkeyServer", "CgiGetVkey", {
    guid: "1008610010",
    songmid: [mid],
    songtype: [0],
    uin: "0",
    loginflag: 1,
    platform: "20",
    filename: [filename],
  });
  return {
    purl: data?.midurlinfo?.[0]?.purl ?? "",
    sip: data?.sip?.[0],
  };
};

const song_url: QMModule = async (params) => {
  const mid = String(params.mid ?? "").trim();
  if (!mid) return { code: 400, url: "", message: "mid required" };

  // filename 前缀决定码率/格式，部分曲目 VIP 限制下 M500 拿不到 purl 但 C600（m4a）仍可
  // 顺序：M500（128k mp3，命中率最高）→ C600（128k m4a，版权宽松）→ M800（320k mp3，VIP 兜底）
  const candidates = [`M500${mid}.mp3`, `C600${mid}.m4a`, `M800${mid}.mp3`];

  for (const filename of candidates) {
    try {
      const { purl, sip } = await fetchPurl(mid, filename);
      if (purl) {
        const host = sip ?? "https://ws.stream.qqmusic.qq.com/";
        const url = `${host}${purl}`;
        qqmusicLog.info(`song_url 命中 ${filename} → ${url.slice(0, 80)}...`);
        return { code: 200, url };
      }
      qqmusicLog.warn(`song_url purl 为空（${filename}），可能是版权/VIP 限制`);
    } catch (err) {
      qqmusicLog.warn(`song_url 请求失败（${filename}）:`, err);
    }
  }

  qqmusicLog.warn(`song_url 所有候选 filename 均无 purl，mid=${mid}`);
  return { code: 200, url: "" };
};

export default song_url;
