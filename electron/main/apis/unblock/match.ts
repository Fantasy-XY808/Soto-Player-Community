import type { SongMatchInfo } from "./types";

/**
 * 归一化歌名用于匹配：小写 + 去除括号及其内容
 * @param name 原始歌名
 * @returns 归一化后的歌名
 */
export const normalizeName = (name: string): string => {
  return name
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, "")
    .trim();
};

/**
 * 归一化艺术家名：小写 + 统一分隔符为空格
 * @param artist 原始艺术家字符串
 * @returns 归一化后的艺术家名
 */
export const normalizeArtist = (artist: string): string => {
  return artist
    .toLowerCase()
    .replace(/[&/、，,;；]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

/**
 * 校验搜索结果是否与原曲匹配（歌名 + 艺术家）
 * @param resultName 搜索结果歌名
 * @param resultArtist 搜索结果艺术家（可选）
 * @param match 原曲匹配信息
 * @returns 是否匹配
 */
export const isSongMatch = (
  resultName: string,
  resultArtist: string | undefined,
  match: SongMatchInfo,
): boolean => {
  const normalizedResult = normalizeName(resultName);
  const normalizedOriginal = normalizeName(match.songName);
  // songName 为空时跳过歌名检查；normalizedResult 为空则视为无效结果，直接拒绝
  if (!normalizedResult) return false;
  if (normalizedOriginal) {
    // 歌名：双向 includes（兼容一方带后缀的情况）
    if (
      !normalizedResult.includes(normalizedOriginal) &&
      !normalizedOriginal.includes(normalizedResult)
    ) {
      return false;
    }
  }
  // 艺术家：归一化分隔符后双向 includes
  if (resultArtist && match.artist) {
    const normalizedResultArtist = normalizeArtist(resultArtist);
    const normalizedOriginalArtist = normalizeArtist(match.artist);
    // 任一归一化后为空则跳过艺术家检查
    if (normalizedResultArtist && normalizedOriginalArtist) {
      if (
        !normalizedResultArtist.includes(normalizedOriginalArtist) &&
        !normalizedOriginalArtist.includes(normalizedResultArtist)
      ) {
        return false;
      }
    }
  }
  return true;
};
