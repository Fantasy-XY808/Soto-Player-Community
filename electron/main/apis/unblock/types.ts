/** 解灰音源标识 */
export type SongUnlockServerKey = "netease" | "kuwo" | "bodian";

/** 歌曲匹配信息 */
export interface SongMatchInfo {
  /** 关键词（"歌名-歌手" 或纯歌名） */
  keyword: string;
  /** 歌名 */
  songName: string;
  /** 歌手 */
  artist: string;
}

/** 解灰结果 */
export interface SongUrlResult {
  /** 状态码：200 表示成功 */
  code: number;
  /** 解灰得到的播放 URL；失败时为 null */
  url: string | null;
  /** 来源标记 */
  from?: SongUnlockServerKey;
  /** 匹配到的歌曲名（用于校验） */
  matchedSongName?: string;
}
