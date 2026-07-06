/**
 * 波点音乐 解灰源
 *
 * 移植自参考项目 bodian.ts，使用 Node 原生 fetch 替代 axios：
 * - 搜索：http://search.kuwo.cn/r.s?...&all={keyword}（与酷我共用搜索接口）
 * - 取 URL：http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?...&sign={md5}
 *
 * 需要 SHA-256 + MD5 签名（基于 timestamp 与查询参数）。
 */

import { createHash } from "node:crypto";
import { unblockLog } from "@main/utils/logger";
import { isSongMatch } from "./match";
import type { SongMatchInfo, SongUrlResult } from "./types";

/**
 * 生成随机设备 ID
 * @returns 随机设备 ID 字符串
 */
const getRandomDeviceId = (): string => {
  const min = 0;
  const max = 100000000000;
  const randomNum = Math.floor(Math.random() * (max - min + 1)) + min;
  return randomNum.toString();
};

/** 随机设备 ID（模块级常量，进程生命周期内复用） */
const deviceId = getRandomDeviceId();

/** 波点搜索结果项（原始字段） */
interface BodianRawItem {
  MUSICRID?: string;
  SONGNAME?: string;
  DURATION?: string | number;
  ALBUMID?: string;
  ALBUM?: string;
  ARTIST?: string;
  ARTISTID?: string;
}

/** 格式化后的歌曲信息 */
interface BodianSong {
  id: string;
  name: string;
  artists: Array<{ id: string | null; name: string }>;
}

/**
 * 格式化波点搜索结果项
 * @param song 原始项
 * @returns 格式化后的项
 */
const format = (song: BodianRawItem): BodianSong => ({
  id: (song.MUSICRID || "").split("_").pop() || "",
  name: song.SONGNAME || "",
  artists: (song.ARTIST || "").split("&").map((name, index) => ({
    id: index ? null : song.ARTISTID || null,
    name,
  })),
});

/**
 * 生成签名（基于查询参数 + timestamp + MD5）
 * @param str 原始 URL
 * @returns 包含签名的 URL
 */
const generateSign = (str: string): string => {
  const url = new URL(str);

  const currentTime = Date.now();
  str += `&timestamp=${currentTime}`;

  const filteredChars = str
    .substring(str.indexOf("?") + 1)
    .replace(/[^a-zA-Z0-9]/g, "")
    .split("")
    .sort();

  const dataToEncrypt = `kuwotest${filteredChars.join("")}${url.pathname}`;
  const md5 = createHash("md5").update(dataToEncrypt).digest("hex");
  return `${str}&sign=${md5}`;
};

/**
 * 搜索波点音乐
 * @param match 原曲匹配信息
 * @returns 歌曲 id 或 null
 */
const search = async (match: SongMatchInfo): Promise<string | null> => {
  try {
    const keyword = encodeURIComponent(match.keyword.replace(" - ", " "));
    const url =
      "http://search.kuwo.cn/r.s?&correct=1&vipver=1&stype=comprehensive&encoding=utf8" +
      "&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=" +
      keyword;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      content?: Array<{ musicpage?: { abslist?: BodianRawItem[] } }>;
    };
    if (
      !data ||
      !data.content ||
      data.content.length < 2 ||
      !data.content[1].musicpage ||
      !data.content[1].musicpage.abslist ||
      data.content[1].musicpage.abslist.length < 1
    ) {
      return null;
    }
    const list = data.content[1].musicpage.abslist.map(format);
    for (const item of list) {
      if (!item?.id) continue;
      const artistStr = item.artists?.map((a) => a.name).join("&") || "";
      if (isSongMatch(item.name || "", artistStr, match)) {
        return item.id;
      }
    }
    unblockLog.warn(`⚠️ Bodian 搜索结果均不匹配原曲: "${match.songName}"`);
    return null;
  } catch (err) {
    unblockLog.error("❌ Get BodianSongId Error:", err);
    return null;
  }
};

/**
 * 发送广告免费请求（波点取流前的必要步骤）
 * @returns Promise（不关心结果，只关心副作用）
 */
const sendAdFreeRequest = async (): Promise<void> => {
  try {
    const adurl =
      "http://bd-api.kuwo.cn/api/service/advert/watch?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da";
    const headers = {
      "user-agent": "Dart/2.19 (dart:io)",
      plat: "ar",
      channel: "aliopen",
      devid: deviceId,
      ver: "3.9.0",
      host: "bd-api.kuwo.cn",
      qimei36: "1e9970cbcdc20a031dee9f37100017e1840e",
      "content-type": "application/json; charset=utf-8",
    };
    const body = JSON.stringify({
      type: 5,
      subType: 5,
      musicId: 0,
      adToken: "",
    });
    await fetch(adurl, { method: "POST", headers, body });
  } catch (err) {
    unblockLog.error("❌ Get Bodian Ad Free Error:", err);
  }
};

/**
 * 波点音乐 解灰入口：搜匹配曲目并取播放 URL
 * @param match 原曲匹配信息
 * @returns 解灰结果
 */
export const getBodianSongUrl = async (match: SongMatchInfo): Promise<SongUrlResult> => {
  try {
    if (!match.keyword) return { code: 404, url: null };
    const songId = await search(match);
    if (!songId) return { code: 404, url: null };
    const headers = {
      "user-agent": "Dart/2.19 (dart:io)",
      plat: "ar",
      channel: "aliopen",
      devid: deviceId,
      ver: "3.9.0",
      host: "bd-api.kuwo.cn",
      "X-Forwarded-For": "1.0.1.114",
    };
    let audioUrl = `http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=${"320kmp3"}&musicId=${songId}`;
    audioUrl = generateSign(audioUrl);
    await sendAdFreeRequest();
    const res = await fetch(audioUrl, { headers });
    if (!res.ok) return { code: 404, url: null };
    const data = (await res.json()) as { data?: { audioUrl?: string } };
    if (typeof data === "object" && data?.data?.audioUrl) {
      unblockLog.log(`🔗 BodianSongUrl: ${data.data.audioUrl}`);
      return { code: 200, url: data.data.audioUrl };
    }
    return { code: 404, url: null };
  } catch (err) {
    unblockLog.error("❌ Get BodianSongUrl Error:", err);
    return { code: 404, url: null };
  }
};
