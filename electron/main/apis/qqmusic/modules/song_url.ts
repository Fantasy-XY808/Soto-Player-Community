/**
 * 获取 QQ 音乐播放 URL（vkey 接口）
 *
 * 协议：u.y.qq.com/cgi-bin/musicu.fcg → music.vkey.GetVkeyServer / CgiGetVkey
 * 匿名态可拿 128k mp3；登录态（withCredentials=true）按 F000 flac → M800 320k 顺序尝试 VIP 高品质
 *
 * params:
 * - mid              songmid（必填），例如 "001qvvgF38HVc4"
 * - withCredentials  true 时优先用 cookie 拿 VIP URL，失败回落匿名候选
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

interface Candidate {
  filename: string;
  /** 是否带 cookie 调用；带 cookie 的候选排在前 */
  withCredentials: boolean;
}

/**
 * 尝试单个 filename 模板拿 purl
 *
 * @param mid             songmid
 * @param filename        形如 M500${mid}.mp3，前缀决定码率与格式
 * @param withCredentials true 时带 cookie 调用，用于 VIP 接口鉴权
 * @returns purl（空字符串表示服务端拒绝或无权限）
 */
const fetchPurl = async (
  mid: string,
  filename: string,
  withCredentials: boolean,
): Promise<{ purl: string; sip?: string }> => {
  const data = await qmRequest<VkeyResp>(
    "music.vkey.GetVkeyServer",
    "CgiGetVkey",
    {
      guid: "1008610010",
      songmid: [mid],
      songtype: [0],
      uin: "0",
      loginflag: 1,
      platform: "20",
      filename: [filename],
    },
    withCredentials,
  );
  return {
    purl: data?.midurlinfo?.[0]?.purl ?? "",
    sip: data?.sip?.[0],
  };
};

const song_url: QMModule = async (params) => {
  const mid = String(params.mid ?? "").trim();
  if (!mid) return { code: 400, url: "", message: "mid required" };
  const withCredentials = params.withCredentials === true;

  // filename 前缀决定码率/格式：
  // F000 = flac（VIP），M800 = 320k mp3（VIP），M500 = 128k mp3（匿名），C600 = 128k m4a（匿名，版权宽松）
  const vipCandidates: Candidate[] = [
    { filename: `F000${mid}.flac`, withCredentials: true },
    { filename: `M800${mid}.mp3`, withCredentials: true },
  ];
  const anonCandidates: Candidate[] = [
    { filename: `M500${mid}.mp3`, withCredentials: false },
    { filename: `C600${mid}.m4a`, withCredentials: false },
  ];
  // VIP 用户：先试高品质候选（带 cookie），失败回落匿名候选
  // 匿名用户：只试匿名候选
  const candidates = withCredentials ? [...vipCandidates, ...anonCandidates] : anonCandidates;

  for (const { filename, withCredentials: useCred } of candidates) {
    try {
      const { purl, sip } = await fetchPurl(mid, filename, useCred);
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
