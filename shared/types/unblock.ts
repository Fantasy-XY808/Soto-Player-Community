import type { SongUnlockServerKey } from "./settings";

/** 解灰匹配信息（与 electron/main/apis/unblock/types.ts 的 SongMatchInfo 同步） */
export interface SongMatchInfo {
  /** 关键词（"歌名-艺术家" 或纯歌名） */
  keyword: string;
  /** 歌名 */
  songName: string;
  /** 艺术家 */
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

/** 解灰相关 IPC */
export interface UnblockApi {
  /** 按配置顺序尝试启用的解灰源，返回首个成功的 URL */
  resolve: (match: SongMatchInfo) => Promise<{ success: boolean; data: SongUrlResult }>;
  /** 单源查询（用于设置面板测试） */
  test: (
    key: SongUnlockServerKey,
    match: SongMatchInfo,
  ) => Promise<{ success: boolean; data: SongUrlResult }>;
}
