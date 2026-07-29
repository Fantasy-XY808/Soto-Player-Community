/**
 * CUE 虚拟路径协议：`cue://<audioPath>#<index>`
 *
 * - audioPath 是 CUE 关联的音频文件绝对路径
 * - index 是 CUE 曲目索引（从 0 开始）
 *
 * 渲染端拿到的 Track.path 形如 `cue:///music/album.flac#2`，
 * 主进程 player:load 时识别该协议并定位到 CUE sheet + 索引。
 */
const CUE_PROTOCOL = "cue://";

export const toCueTrackPath = (audioPath: string, index: number): string =>
  `${CUE_PROTOCOL}${audioPath}#${index}`;

export const extractCuePath = (
  trackPath: string,
): { audioPath: string; index: number } | null => {
  if (!trackPath.startsWith(CUE_PROTOCOL)) return null;
  const rest = trackPath.slice(CUE_PROTOCOL.length);
  const hashIdx = rest.lastIndexOf("#");
  if (hashIdx < 0) return null;
  const audioPath = rest.slice(0, hashIdx);
  const index = Number.parseInt(rest.slice(hashIdx + 1), 10);
  if (!Number.isFinite(index) || index < 0) return null;
  return { audioPath, index };
};

export const getCueAudioPath = (trackPath: string): string =>
  extractCuePath(trackPath)?.audioPath ?? trackPath;

export const isCueTrackPath = (trackPath: string): boolean =>
  trackPath.startsWith(CUE_PROTOCOL);
