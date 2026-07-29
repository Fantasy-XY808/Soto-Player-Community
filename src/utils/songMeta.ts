/**
 * 歌曲元数据位掩码常量
 *
 * 网易云 mark 字段是一个位掩码，每一位代表一种元数据标记。
 * 这里集中维护前端需要的位掩码常量及判定工具。
 */

/**
 * 脏标位（Explicit Content，明确歌词标记）
 *
 * 网易云 mark 第 20 位（值 1048576 = 2^20 = 1 << 20）。
 * 标记后歌曲可能含有不雅歌词，UI 上以红色 "E" 标签提示。
 */
export const EXPLICIT_CONTENT_MARK = 1 << 20;

/**
 * 判断歌曲是否带脏标
 * @param mark - 歌曲 mark 字段；undefined / null / 0 视为无脏标
 */
export const isExplicit = (mark?: number | null): boolean => {
  if (!mark) return false;
  return (mark & EXPLICIT_CONTENT_MARK) !== 0;
};

/**
 * 原唱/翻唱三态枚举（与 Track.originCoverType 对应）
 */
export enum OriginCoverType {
  Unknown = 0,
  Original = 1,
  Cover = 2,
}

/**
 * 判断歌曲是否原唱
 *
 * 优先用 originCoverType === 1，回退 original === true（向后兼容）
 */
export const isOriginalSong = (track: {
  originCoverType?: 0 | 1 | 2;
  original?: boolean;
}): boolean => {
  if (track.originCoverType !== undefined) {
    return track.originCoverType === OriginCoverType.Original;
  }
  return track.original === true;
};

/**
 * 判断歌曲是否翻唱
 */
export const isCoverSong = (track: { originCoverType?: 0 | 1 | 2 }): boolean => {
  return track.originCoverType === OriginCoverType.Cover;
};

/**
 * 判断歌曲是否有 MV
 */
export const hasMv = (mv?: number | string | null): boolean => {
  if (mv == null) return false;
  if (typeof mv === "number") return mv > 0;
  const trimmed = String(mv).trim();
  return trimmed !== "" && trimmed !== "0";
};
