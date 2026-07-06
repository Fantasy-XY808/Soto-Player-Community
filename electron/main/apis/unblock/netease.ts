/**
 * GD音乐台 解灰源
 *
 * 基于 music-api.gdstudio.xyz 提供的公开 API：
 * - 搜索：?types=search&name={keyword}&count=10&type=song
 * - 取 URL：?types=url&id={id}
 *
 * 移植自参考项目 index.ts 的 getNeteaseSongUrl；原实现只接受 Netease 歌曲 id，
 * 此处扩展为先按 keyword 搜索匹配曲目，再取其播放链接，以适配统一的 SongMatchInfo 入参。
 */

import { unblockLog } from "@main/utils/logger";
import { isSongMatch } from "./match";
import type { SongMatchInfo, SongUrlResult } from "./types";

/** GD音乐台 API 基础地址 */
const BASE_URL = "https://music-api.gdstudio.xyz/api.php";

/** 搜索结果项（仅取需要的字段） */
interface SearchHit {
  id: string | number;
  name: string;
  artist?: string;
}

/**
 * 按关键词搜索 GD音乐台，返回候选列表
 * @param keyword 搜索关键词
 * @returns 候选列表；请求失败返回空数组
 */
const searchByKeyword = async (keyword: string): Promise<SearchHit[]> => {
  const url = `${BASE_URL}?types=search&name=${encodeURIComponent(keyword)}&count=10&type=song`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as SearchHit[];
  return Array.isArray(data) ? data : [];
};

/**
 * 按 GD音乐台 歌曲 id 取播放 URL
 * @param id 歌曲 id
 * @returns 播放 URL 或 null
 */
const fetchUrlById = async (id: string | number): Promise<string | null> => {
  const url = `${BASE_URL}?types=url&id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { url?: string };
  return data.url ?? null;
};

/**
 * GD音乐台 解灰入口：搜匹配曲目并取播放 URL
 * @param match 原曲匹配信息
 * @returns 解灰结果
 */
export const getNeteaseSongUrl = async (match: SongMatchInfo): Promise<SongUrlResult> => {
  try {
    if (!match.keyword) return { code: 404, url: null };
    const hits = await searchByKeyword(match.keyword);
    if (hits.length === 0) {
      unblockLog.warn(`GD音乐台 无搜索结果: "${match.songName}"`);
      return { code: 404, url: null };
    }
    const matched = hits.find((h) => isSongMatch(h.name || "", h.artist, match));
    if (!matched) {
      unblockLog.warn(`GD音乐台 搜索结果均不匹配原曲: "${match.songName}"`);
      return { code: 404, url: null };
    }
    const songUrl = await fetchUrlById(matched.id);
    if (!songUrl) return { code: 404, url: null };
    unblockLog.log(`🔗 NeteaseSongUrl: ${songUrl}`);
    return { code: 200, url: songUrl, matchedSongName: matched.name };
  } catch (err) {
    unblockLog.error("❌ Get NeteaseSongUrl Error:", err);
    return { code: 404, url: null };
  }
};
