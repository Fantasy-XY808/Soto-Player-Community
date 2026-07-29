/**
 * CUE sheet 解析器
 *
 * 将 CUE 文件文本解析为结构化数据。仅支持单 FILE 的 CUE
 * （多 FILE 场景在 Soto 母带扫描中不常见，遇到时取首个 FILE）。
 *
 * 时间格式 MM:SS:FF（MM 分、SS 秒、FF 帧，CUE 标准为 75 帧/秒）。
 */
import path from "node:path";
import type { CueSheet, CueTrack, CueTrackInfo } from "../../../shared/types/cue";
import { toCueTrackPath } from "../../../shared/utils/cuePath";

const TIME_PATTERN = /^(\d{1,3}):(\d{2}):(\d{2})$/;

/** MM:SS:FF → 秒（75 帧/秒，CUE 标准） */
const cueTimeToSeconds = (mmssff: string): number => {
  const m = TIME_PATTERN.exec(mmssff);
  if (!m) throw new Error(`Invalid CUE time: ${mmssff}`);
  const [, mm, ss, ff] = m;
  return Number.parseInt(mm, 10) * 60 + Number.parseInt(ss, 10) + Number.parseInt(ff, 10) / 75;
};

/** 去除 CUE 字符串两端的引号 */
const unquote = (s: string): string => s.trim().replace(/^"|"$/g, "");

/** 去除路径末尾的分隔符（同时支持 / 和 \） */
const stripTrailingSeps = (s: string): string => {
  let end = s.length;
  while (end > 0 && (s[end - 1] === "/" || s[end - 1] === "\\")) end--;
  return s.slice(0, end);
};

/** 查找路径中最后一个分隔符位置（/ 或 \），找不到返回 -1 */
const findLastSep = (s: string): number => {
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === "/" || s[i] === "\\") return i;
  }
  return -1;
};

/**
 * 解析 CUE 文本为 CueSheet
 * @param text CUE 文件内容
 * @param cuePath CUE 文件绝对路径（用于推导 audioPath）
 */
export const parseCueSheet = (text: string, cuePath: string): CueSheet => {
  // cueDir 保留输入路径的分隔符风格（/ 或 \），仅去除末尾分隔符
  const cueDir = stripTrailingSeps(path.dirname(cuePath));
  const lines = text.split(/\r?\n/);

  let audioPath = "";
  let audioType = "";
  let albumTitle: string | null = null;
  let albumPerformer: string | null = null;
  const tracks: CueTrack[] = [];

  let currentTrack: (Partial<CueTrack> & { _index_01_sec?: number }) | null = null;
  let trackCounter = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // FILE "name" TYPE
    const fileMatch = /^FILE\s+(.+?)\s+(WAVE|MP3|FLAC|APE|OGG|AIFF|MPC|WV|TTA)$/i.exec(line);
    if (fileMatch && !audioPath) {
      const filename = unquote(fileMatch[1]);
      // 将 cuePath 的 basename 替换为音频文件名，保留原分隔符风格
      const lastSep = findLastSep(cuePath);
      audioPath = lastSep >= 0 ? cuePath.slice(0, lastSep + 1) + filename : filename;
      audioType = fileMatch[2].toUpperCase();
      continue;
    }

    // TRACK n AUDIO
    const trackMatch = /^TRACK\s+(\d+)\s+AUDIO/i.exec(line);
    if (trackMatch) {
      if (currentTrack && currentTrack._index_01_sec !== undefined) {
        tracks.push(currentTrack as CueTrack);
      }
      currentTrack = {
        index: trackCounter++,
        trackNumber: Number.parseInt(trackMatch[1], 10),
        title: "",
        artist: null,
        album: null,
        startTimeSec: 0,
        endTimeSec: null,
        _index_01_sec: undefined,
      };
      continue;
    }

    if (!currentTrack) {
      // 全局字段
      const titleMatch = /^TITLE\s+(.+)$/i.exec(line);
      if (titleMatch) albumTitle = unquote(titleMatch[1]);
      const performerMatch = /^PERFORMER\s+(.+)$/i.exec(line);
      if (performerMatch) albumPerformer = unquote(performerMatch[1]);
      continue;
    }

    // 曲目字段
    const titleMatch = /^TITLE\s+(.+)$/i.exec(line);
    if (titleMatch) {
      currentTrack.title = unquote(titleMatch[1]);
      continue;
    }
    const performerMatch = /^PERFORMER\s+(.+)$/i.exec(line);
    if (performerMatch) {
      currentTrack.artist = unquote(performerMatch[1]);
      continue;
    }
    const indexMatch = /^INDEX\s+01\s+(\d{1,3}:\d{2}:\d{2})$/i.exec(line);
    if (indexMatch) {
      currentTrack._index_01_sec = cueTimeToSeconds(indexMatch[1]);
      currentTrack.startTimeSec = currentTrack._index_01_sec;
    }
  }

  if (currentTrack && currentTrack._index_01_sec !== undefined) {
    tracks.push(currentTrack as CueTrack);
  }

  // 填充 endTimeSec 与 album
  for (let i = 0; i < tracks.length; i++) {
    tracks[i].endTimeSec = i + 1 < tracks.length ? tracks[i + 1].startTimeSec : null;
    tracks[i].album = albumTitle;
    if (!tracks[i].artist) tracks[i].artist = albumPerformer;
  }

  return {
    cueDir,
    audioPath,
    audioType,
    tracks,
  };
};

/** 将 CueSheet 转换为 CueTrackInfo[]，供曲库写入使用 */
export const toCueTrackInfos = (sheet: CueSheet): CueTrackInfo[] => {
  return sheet.tracks.map((t) => {
    const durationMs = t.endTimeSec !== null
      ? Math.round((t.endTimeSec - t.startTimeSec) * 1000)
      : null;
    return {
      path: toCueTrackPath(sheet.audioPath, t.index),
      audioPath: sheet.audioPath,
      cueIndex: t.index,
      title: t.title,
      artist: t.artist,
      album: t.album,
      startTimeMs: Math.round(t.startTimeSec * 1000),
      endTimeMs: t.endTimeSec !== null ? Math.round(t.endTimeSec * 1000) : null,
      durationMs,
    };
  });
};
