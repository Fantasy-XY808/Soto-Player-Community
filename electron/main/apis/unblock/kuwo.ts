/**
 * 酷我音乐 解灰源
 *
 * 移植自参考项目 kuwo.ts，使用 Node 原生 fetch 替代 axios：
 * - 搜索：http://search.kuwo.cn/r.s?...&all={keyword}
 * - 取 URL：http://mobi.kuwo.cn/mobi.s?f=kuwo&q={encryptQuery(...)}
 *
 * 酷我 mobi 接口的查询参数需要 DES 加密后 base64 编码，依赖 kwDES.ts 的 encryptQuery。
 */

import { unblockLog } from "@main/utils/logger";
import { encryptQuery } from "./kwDES";
import { isSongMatch } from "./match";
import type { SongMatchInfo, SongUrlResult } from "./types";

/** 酷我搜索结果项（仅取需要的字段） */
interface KuwoSearchItem {
  MUSICRID?: string;
  SONGNAME?: string;
  ARTIST?: string;
}

/** 酷我搜索响应结构 */
interface KuwoSearchResponse {
  content?: Array<{ musicpage?: { abslist?: KuwoSearchItem[] } }>;
}

/**
 * 通过关键词搜索酷我音乐，返回匹配的歌曲 id
 * @param match 原曲匹配信息
 * @returns 歌曲 id 或 null
 */
const getKuwoSongId = async (match: SongMatchInfo): Promise<string | null> => {
  try {
    const url =
      "http://search.kuwo.cn/r.s?&correct=1&stype=comprehensive&encoding=utf8&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=" +
      encodeURIComponent(match.keyword);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as KuwoSearchResponse;
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
    for (const item of data.content[1].musicpage.abslist) {
      const songId = item?.MUSICRID;
      if (!songId) continue;
      if (isSongMatch(item?.SONGNAME || "", item?.ARTIST, match)) {
        return songId.slice("MUSIC_".length);
      }
    }
    unblockLog.warn(`⚠️ Kuwo 搜索结果均不匹配原曲: "${match.songName}"`);
    return null;
  } catch (err) {
    unblockLog.error("❌ Get KuwoSongId Error:", err);
    return null;
  }
};

/**
 * 酷我音乐 解灰入口：搜匹配曲目并取播放 URL
 * @param match 原曲匹配信息
 * @returns 解灰结果
 */
export const getKuwoSongUrl = async (match: SongMatchInfo): Promise<SongUrlResult> => {
  try {
    if (!match.keyword) return { code: 404, url: null };
    const songId = await getKuwoSongId(match);
    if (!songId) return { code: 404, url: null };
    // 请求地址
    const PackageName = "kwplayer_ar_5.1.0.0_B_jiakong_vh.apk";
    const url =
      "http://mobi.kuwo.cn/mobi.s?f=kuwo&q=" +
      encryptQuery(
        `corp=kuwo&source=${PackageName}&p2p=1&type=convert_url2&sig=0&format=mp3` +
          "&rid=" +
          songId,
      );
    const res = await fetch(url, {
      headers: { "User-Agent": "okhttp/3.10.0" },
    });
    if (!res.ok) return { code: 404, url: null };
    const text = await res.text();
    const urlMatch = text.match(/http[^\s$"]+/);
    if (!urlMatch) return { code: 404, url: null };
    unblockLog.log(`🔗 KuwoSongUrl: ${urlMatch[0]}`);
    return { code: 200, url: urlMatch[0] };
  } catch (err) {
    unblockLog.error("❌ Get KuwoSongUrl Error:", err);
    return { code: 404, url: null };
  }
};
