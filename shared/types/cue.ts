/**
 * CUE sheet 解析结果
 *
 * 解析 CUE 文件文本，得到原始曲目列表 + 关联的音频文件路径。
 * 主进程 services/cue.ts 调用 parseCueSheet，渲染端不直接使用。
 */
export interface CueSheet {
  /** CUE 文件所在目录（用于解析 FILE 相对路径） */
  cueDir: string;
  /** CUE 引用的音频文件绝对路径（首个 FILE） */
  audioPath: string;
  /** 音频文件类型（FILE 行第二个 token，如 "WAVE" / "FLAC" / "MP3"） */
  audioType: string;
  /** 曲目列表（已排序，索引从 0 开始） */
  tracks: CueTrack[];
}

export interface CueTrack {
  /** 在 CUE 中的索引（0-based） */
  index: number;
  /** 曲目编号（CUE 中 TRACK n AUDIO 的 n） */
  trackNumber: number;
  /** 标题（TITLE 行） */
  title: string;
  /** 歌手（PERFORMER 行，可被曲库元数据覆盖） */
  artist: string | null;
  /** 专辑名（首曲 REM 专辑 或全局 TITLE） */
  album: string | null;
  /** 起始时间（秒，INDEX 01 MM:SS:FF 换算） */
  startTimeSec: number;
  /** 结束时间（秒，下一曲 startTime 减去当前；最后一曲为 null 表示到文件结束） */
  endTimeSec: number | null;
}

/**
 * 渲染端使用的 CUE 曲目视图（与 Track 兼容）
 *
 * 主进程将 CueSheet 转换为 CueTrackInfo[] 后写入曲库，
 * path 字段使用 `cue://<audioPath>#<index>` 协议。
 */
export interface CueTrackInfo {
  /** cue:// 协议路径 */
  path: string;
  /** 关联的音频文件绝对路径 */
  audioPath: string;
  /** 在 CUE 中的索引 */
  cueIndex: number;
  title: string;
  artist: string | null;
  album: string | null;
  /** 起始时间（毫秒） */
  startTimeMs: number;
  /** 结束时间（毫秒，最后一曲为 null） */
  endTimeMs: number | null;
  /** 时长（毫秒，最后一曲为 null 表示未知） */
  durationMs: number | null;
}
