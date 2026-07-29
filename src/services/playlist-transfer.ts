/**
 * 歌单导入/导出序列化服务
 *
 * 支持三种格式：
 * - JSON：项目自身导出格式，完整保留歌曲元数据（标题/艺术家/专辑/时长/源 URL/封面/平台 ID）
 * - M3U/M3U8：标准播放列表格式，音乐播放器通用
 * - CSV：表格格式，便于查看与编辑
 *
 * 设计：
 * - 序列化端：把 Track[] → PlaylistExportTrack[] → 字符串
 * - 反序列化端：字符串 → PlaylistImportResult（含解析错误列表）
 * - 反序列化不直接产生 Track，需要调用方根据 platform/platformId/source 重新解析
 */

import type { Track } from "@shared/types/player";
import { APP_VERSION } from "@/utils/config";

/** 导出格式 */
export type PlaylistExportFormat = "json" | "m3u" | "csv";

/** 导出的歌单元数据 */
export interface PlaylistExportMeta {
  name: string;
  description?: string;
  /** ISO 时间戳 */
  exportedAt: string;
  trackCount: number;
  /** 应用版本 */
  version: string;
}

/** 导出的歌单数据（JSON 格式） */
export interface PlaylistExportData {
  meta: PlaylistExportMeta;
  tracks: PlaylistExportTrack[];
}

/** 导出的单曲信息（剥离 Track 中所有运行时上下文，仅保留可序列化的元数据） */
export interface PlaylistExportTrack {
  title: string;
  artist: string;
  album?: string;
  /** 时长（秒） */
  duration?: number;
  /** 源 URL 或本地路径 */
  source?: string;
  cover?: string;
  /** 原始平台标识（netease / qqmusic / kugou / local 等） */
  platform?: string;
  /** 平台歌曲 ID */
  platformId?: string;
}

/** 导入结果 */
export interface PlaylistImportResult {
  success: boolean;
  format: PlaylistExportFormat;
  meta?: PlaylistExportMeta;
  tracks: PlaylistExportTrack[];
  errors: string[];
}

/** 应用版本兜底（config 模块未注入时取 1.0.0） */
const resolveAppVersion = (): string => {
  try {
    return APP_VERSION ?? "1.0.0";
  } catch {
    return "1.0.0";
  }
};

/**
 * 把内部 Track 转为可导出的精简结构
 *
 * 剥离：
 * - mf 上下文（MusicFree 运行时引用，不可序列化）
 * - quality / hashes / extId 等平台特定字段（导入端会重新解析）
 *
 * 保留 platform/platformId 让导入端能重新解析为可播放 Track
 */
const trackToExport = (track: Track): PlaylistExportTrack => {
  const artists = track.artists?.map((a) => a.name).filter(Boolean).join(", ");
  return {
    title: track.title || "未知标题",
    artist: artists || "未知艺术家",
    album: track.album?.name || undefined,
    duration: track.duration > 0 ? Math.round(track.duration / 1000) : undefined,
    source: track.source === "local" ? track.path : track.path,
    cover: track.cover,
    platform: track.source,
    platformId: track.id,
  };
};

/** 默认歌单名兜底 */
const sanitizePlaylistName = (name: string | undefined | null): string => {
  const trimmed = (name ?? "").trim();
  return trimmed || "未命名歌单";
};

/** 构建导出 meta */
const buildMeta = (name: string, tracks: PlaylistExportTrack[]): PlaylistExportMeta => ({
  name: sanitizePlaylistName(name),
  exportedAt: new Date().toISOString(),
  trackCount: tracks.length,
  version: resolveAppVersion(),
});

/**
 * 序列化为 JSON
 * 完整保留元数据，可直接被本应用重新导入还原
 */
const serializeJson = (meta: PlaylistExportMeta, tracks: PlaylistExportTrack[]): string => {
  const data: PlaylistExportData = { meta, tracks };
  return JSON.stringify(data, null, 2);
};

/**
 * CSV 字段转义：包含逗号/双引号/换行的字段需用双引号包裹，内部双引号转义为两个双引号
 */
const escapeCsvField = (value: string | undefined): string => {
  if (value === undefined || value === null) return "";
  const str = String(value);
  if (/["\n\r,]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * 序列化为 CSV
 * 首行 header，后续每行一首歌
 */
const serializeCsv = (meta: PlaylistExportMeta, tracks: PlaylistExportTrack[]): string => {
  const header = "title,artist,album,duration,source,cover,platform,platformId";
  const rows = tracks.map((t) =>
    [
      escapeCsvField(t.title),
      escapeCsvField(t.artist),
      escapeCsvField(t.album),
      t.duration ?? "",
      escapeCsvField(t.source),
      escapeCsvField(t.cover),
      escapeCsvField(t.platform),
      escapeCsvField(t.platformId),
    ].join(","),
  );
  // 在文件头写入 #PLAYLIST: 行（以 # 开头，CSV 解析器会作为注释行忽略，但本应用能识别）
  return `#PLAYLIST:${meta.name}\n${header}\n${rows.join("\n")}`;
};

/**
 * 序列化为 M3U/M3U8
 * 标准格式：#EXTM3U 头 + #PLAYLIST: + #EXTINF 行
 */
const serializeM3u = (meta: PlaylistExportMeta, tracks: PlaylistExportTrack[]): string => {
  const lines: string[] = ["#EXTM3U"];
  lines.push(`#PLAYLIST:${meta.name}`);
  if (meta.description) {
    lines.push(`#PLAYLIST-DESC:${meta.description}`);
  }
  for (const t of tracks) {
    const duration = typeof t.duration === "number" && t.duration > 0 ? t.duration : -1;
    const artist = t.artist || "";
    const title = t.title || "";
    const label = artist && title ? `${artist} - ${title}` : title || artist;
    lines.push(`#EXTINF:${duration},${label}`);
    if (t.album) lines.push(`#EXTALB:${t.album}`);
    if (t.cover) lines.push(`#EXTART-COVER:${t.cover}`);
    if (t.platform) lines.push(`#PLATFORM:${t.platform}`);
    if (t.platformId) lines.push(`#PLATFORM-ID:${t.platformId}`);
    // 源 URL/路径；缺失时写空行，导入端会通过 platform/platformId 重新解析
    lines.push(t.source ?? "");
  }
  return lines.join("\n");
};

/**
 * 导出歌单为字符串
 *
 * @param name - 歌单名称
 * @param tracks - 歌曲列表
 * @param format - 导出格式
 * @param description - 歌单描述（可选）
 */
export const serializePlaylist = (
  name: string,
  tracks: Track[],
  format: PlaylistExportFormat,
  description?: string,
): string => {
  const exportTracks = tracks.map(trackToExport);
  const meta = buildMeta(name, exportTracks);
  if (description) meta.description = description;
  switch (format) {
    case "json":
      return serializeJson(meta, exportTracks);
    case "m3u":
      return serializeM3u(meta, exportTracks);
    case "csv":
      return serializeCsv(meta, exportTracks);
  }
};

/** 从文件名推断格式 */
const detectFormat = (filename: string): PlaylistExportFormat | null => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".m3u") || lower.endsWith(".m3u8")) return "m3u";
  if (lower.endsWith(".csv")) return "csv";
  return null;
};

/** CSV 字段解析（处理引号包裹与转义） */
const parseCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
};

/** 解析 JSON 格式 */
const parseJson = (content: string, errors: string[]): PlaylistImportResult => {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (err) {
    errors.push(`JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, format: "json", tracks: [], errors };
  }
  if (!data || typeof data !== "object") {
    errors.push("JSON 内容不是有效对象");
    return { success: false, format: "json", tracks: [], errors };
  }
  const obj = data as Partial<PlaylistExportData>;
  if (!Array.isArray(obj.tracks)) {
    errors.push("缺少 tracks 数组");
    return { success: false, format: "json", tracks: [], errors };
  }
  const tracks: PlaylistExportTrack[] = [];
  for (let i = 0; i < obj.tracks.length; i++) {
    const raw = obj.tracks[i];
    if (!raw || typeof raw !== "object") {
      errors.push(`第 ${i + 1} 首歌不是有效对象`);
      continue;
    }
    const r = raw as Partial<PlaylistExportTrack>;
    tracks.push({
      title: r.title ?? "未知标题",
      artist: r.artist ?? "未知艺术家",
      album: r.album,
      duration: typeof r.duration === "number" ? r.duration : undefined,
      source: r.source,
      cover: r.cover,
      platform: r.platform,
      platformId: r.platformId,
    });
  }
  const meta = obj.meta as PlaylistExportMeta | undefined;
  return {
    success: tracks.length > 0,
    format: "json",
    meta: meta,
    tracks,
    errors,
  };
};

/** 解析 M3U/M3U8 格式 */
const parseM3u = (content: string, errors: string[]): PlaylistImportResult => {
  const lines = content.split(/\r?\n/);
  let name = "导入的歌单";
  let description: string | undefined;
  let currentTrack: Partial<PlaylistExportTrack> = {};
  const tracks: PlaylistExportTrack[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      // 头部
      if (line.toUpperCase().startsWith("#EXTM3U")) continue;
      if (line.toUpperCase().startsWith("#PLAYLIST:")) {
        name = line.slice("#PLAYLIST:".length).trim() || name;
        continue;
      }
      if (line.toUpperCase().startsWith("#PLAYLIST-DESC:")) {
        description = line.slice("#PLAYLIST-DESC:".length).trim() || undefined;
        continue;
      }
      if (line.toUpperCase().startsWith("#EXTINF:")) {
        // #EXTINF:duration,artist - title
        const body = line.slice("#EXTINF:".length);
        const commaIdx = body.indexOf(",");
        const duration =
          commaIdx > 0 ? parseInt(body.slice(0, commaIdx), 10) : undefined;
        const label = commaIdx > 0 ? body.slice(commaIdx + 1) : "";
        const trimmedLabel = label.trim();
        let title = trimmedLabel;
        let artist = "";
        const dashIdx = trimmedLabel.indexOf(" - ");
        if (dashIdx > 0) {
          artist = trimmedLabel.slice(0, dashIdx).trim();
          title = trimmedLabel.slice(dashIdx + 3).trim();
        }
        currentTrack = {
          ...(currentTrack as object),
          title,
          artist,
          duration: typeof duration === "number" && !Number.isNaN(duration) && duration > 0
            ? duration
            : undefined,
        };
        continue;
      }
      if (line.toUpperCase().startsWith("#EXTALB:")) {
        currentTrack.album = line.slice("#EXTALB:".length).trim() || undefined;
        continue;
      }
      if (line.toUpperCase().startsWith("#EXTART-COVER:")) {
        currentTrack.cover = line.slice("#EXTART-COVER:".length).trim() || undefined;
        continue;
      }
      if (line.toUpperCase().startsWith("#PLATFORM:")) {
        currentTrack.platform = line.slice("#PLATFORM:".length).trim() || undefined;
        continue;
      }
      if (line.toUpperCase().startsWith("#PLATFORM-ID:")) {
        currentTrack.platformId = line.slice("#PLATFORM-ID:".length).trim() || undefined;
        continue;
      }
      // 其他注释行忽略
      continue;
    }
    // URI 行
    currentTrack.source = line;
    tracks.push({
      title: currentTrack.title ?? "未知标题",
      artist: currentTrack.artist ?? "未知艺术家",
      album: currentTrack.album,
      duration: currentTrack.duration,
      source: currentTrack.source,
      cover: currentTrack.cover,
      platform: currentTrack.platform,
      platformId: currentTrack.platformId,
    });
    currentTrack = {};
  }
  return {
    success: tracks.length > 0,
    format: "m3u",
    meta: {
      name,
      description,
      exportedAt: new Date().toISOString(),
      trackCount: tracks.length,
      version: resolveAppVersion(),
    },
    tracks,
    errors,
  };
};

/** 解析 CSV 格式 */
const parseCsv = (content: string, errors: string[]): PlaylistImportResult => {
  const lines = content.split(/\r?\n/);
  let name = "导入的歌单";
  let headerIdx = 0;
  // 头部可能有 #PLAYLIST: 行
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.toUpperCase().startsWith("#PLAYLIST:")) {
      name = line.slice("#PLAYLIST:".length).trim() || name;
      headerIdx = i + 1;
      continue;
    }
    headerIdx = i;
    break;
  }
  // 找表头
  let headerLine = "";
  let dataStart = headerIdx;
  for (let i = headerIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    headerLine = line;
    dataStart = i + 1;
    break;
  }
  if (!headerLine) {
    errors.push("CSV 文件缺少表头");
    return { success: false, format: "csv", tracks: [], errors };
  }
  const headers = parseCsvLine(headerLine).map((h) => h.trim().toLowerCase());
  const idxOf = (key: string): number => headers.indexOf(key);
  const col = {
    title: idxOf("title"),
    artist: idxOf("artist"),
    album: idxOf("album"),
    duration: idxOf("duration"),
    source: idxOf("source"),
    cover: idxOf("cover"),
    platform: idxOf("platform"),
    platformId: idxOf("platformid"),
  };
  if (col.title === -1) {
    errors.push("CSV 表头缺少 title 列");
    return { success: false, format: "csv", tracks: [], errors };
  }
  const tracks: PlaylistExportTrack[] = [];
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    const get = (k: number): string | undefined =>
      k >= 0 && k < fields.length && fields[k] ? fields[k] : undefined;
    const durationStr = get(col.duration);
    let duration: number | undefined;
    if (durationStr) {
      const n = parseInt(durationStr, 10);
      if (!Number.isNaN(n) && n > 0) duration = n;
    }
    tracks.push({
      title: get(col.title) ?? "未知标题",
      artist: get(col.artist) ?? "未知艺术家",
      album: get(col.album),
      duration,
      source: get(col.source),
      cover: get(col.cover),
      platform: get(col.platform),
      platformId: get(col.platformId),
    });
  }
  return {
    success: tracks.length > 0,
    format: "csv",
    meta: {
      name,
      exportedAt: new Date().toISOString(),
      trackCount: tracks.length,
      version: resolveAppVersion(),
    },
    tracks,
    errors,
  };
};

/**
 * 从字符串解析歌单
 *
 * @param content 文件内容
 * @param filename 文件名（用于推断格式）
 */
export const parsePlaylist = (
  content: string,
  filename: string,
): PlaylistImportResult => {
  const errors: string[] = [];
  if (!content || !content.trim()) {
    errors.push("文件内容为空");
    return { success: false, format: "json", tracks: [], errors };
  }
  const format = detectFormat(filename);
  if (!format) {
    errors.push(`无法识别文件格式: ${filename}`);
    return { success: false, format: "json", tracks: [], errors };
  }
  switch (format) {
    case "json":
      return parseJson(content, errors);
    case "m3u":
      return parseM3u(content, errors);
    case "csv":
      return parseCsv(content, errors);
  }
};

/**
 * 把导出 track 的时长（秒）格式化为 mm:ss 用于 UI 展示
 */
export const formatExportDuration = (seconds: number | undefined): string => {
  if (typeof seconds !== "number" || seconds <= 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/**
 * 文件后缀对应表
 */
export const FORMAT_EXTENSIONS: Record<PlaylistExportFormat, string> = {
  json: "json",
  m3u: "m3u",
  csv: "csv",
};

/**
 * 支持的导入文件后缀列表（用于拖入文件后缀校验）
 */
export const SUPPORTED_IMPORT_EXTENSIONS = [".json", ".m3u", ".m3u8", ".csv"];

/**
 * 判断文件名是否为支持的导入格式
 */
export const isSupportedImportFile = (filename: string): boolean => {
  const lower = filename.toLowerCase();
  return SUPPORTED_IMPORT_EXTENSIONS.some((ext) => lower.endsWith(ext));
};
