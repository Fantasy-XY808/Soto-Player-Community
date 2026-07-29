/**
 * 获取 Internet Archive 播放 URL
 *
 * 流程：
 * 1. 调 /metadata/{identifier} 拿到完整 files 数组
 * 2. 在 files 中按优先级选最大体积的音频文件，优先级受 quality 参数控制：
 *    - 高音质档位（lossless/hi-res/jymaster/sky/jyeffect）：优先 flac（24bit/96kHz+）
 *      → 回落 ogg → 回落 mp3
 *    - 常规档位（hq/sq/lq）或不传：优先 mp3（VBR MP3）→ 回落 flac → 回落 ogg
 *    按用户音质档位选优先级，避免高音质档位时被固定优先的 mp3 抢先。
 * 3. 拼装下载 URL：https://archive.org/download/{identifier}/{filename}
 *
 * params:
 * - trackId  archive.org identifier（必填，如 "GratefulDead-1972-..."）
 * - quality  用户音质档位（可选）；高音质优先 flac，常规优先 mp3
 */

import { ARCHIVE_API_BASE } from "../core/config";
import { archiveRequest } from "../core/request";
import { archiveLog } from "@main/utils/logger";
import type { ArchiveModule } from "../core/types";

interface ArchiveFileRaw {
  /** 文件名（相对 identifier 根目录） */
  name?: string;
  /** 字节大小（字符串形式） */
  size?: string | number;
  /** archive.org 派生格式标识，如 "VBR MP3" / "Flac" / "Ogg Vorbis" */
  format?: string;
  /** 物理文件扩展名（mp3 / flac / ogg ...） */
  ext?: string;
}

interface ArchiveMetadataResp {
  /** 文件列表（含派生格式） */
  files?: ArchiveFileRaw[];
  /** 顶层元数据 */
  metadata?: {
    identifier?: string;
    title?: string;
  };
}

interface FileCandidate {
  /** 完整下载 URL 用的相对路径 */
  name: string;
  /** 体积（字节），用于排序选最大 */
  size: number;
  /** 优先级：越小越优先；按 quality 动态决定 */
  priority: number;
  /** 文件格式标识 */
  format?: string;
}

/**
 * 高音质档位集合：用户选择这些档位时优先返回 flac
 *
 * 注意：jyeffect/sky 是空间音频格式，archive.org 没有 Dolby Atmos / MQA，
 * 但这些档位在语义上对应高音质意图，所以一并优先 flac
 */
const HIGH_RES_QUALITIES = new Set([
  "lossless",
  "hi-res",
  "jyeffect",
  "sky",
  "jymaster",
]);

/**
 * 按音质档位决定文件扩展名优先级
 *
 * @param quality - 用户音质档位
 * @returns 优先级映射：mp3/flac/ogg 各自的 priority 值（越小越优先）
 */
const buildPriorityByQuality = (
  quality?: string,
): Record<string, number> => {
  if (quality && HIGH_RES_QUALITIES.has(quality)) {
    // 高音质：flac → ogg → mp3
    return { flac: 0, ogg: 1, mp3: 2 };
  }
  // 常规档位（默认）：mp3 → flac → ogg
  return { mp3: 0, flac: 1, ogg: 2 };
};

const pickExt = (file: ArchiveFileRaw): string => {
  if (file.ext) return file.ext.toLowerCase().replace(/^\./, "");
  if (!file.name) return "";
  const idx = file.name.lastIndexOf(".");
  return idx >= 0 ? file.name.slice(idx + 1).toLowerCase() : "";
};

const sizeToNum = (size: string | number | undefined): number => {
  if (size == null) return 0;
  if (typeof size === "number") return size;
  const n = Number(size);
  return Number.isFinite(n) ? n : 0;
};

const buildCandidates = (
  files: ArchiveFileRaw[],
  priorityMap: Record<string, number>,
): FileCandidate[] => {
  const list: FileCandidate[] = [];
  for (const file of files) {
    if (!file.name) continue;
    const ext = pickExt(file);
    const isVbrMp3 = file.format === "VBR MP3";
    // 仅纳入 mp3 / flac / ogg / VBR MP3；忽略 derivative 元数据 / 图片 / 文本
    if (!(ext in priorityMap) && !isVbrMp3) continue;
    // VBR MP3 视为 mp3 优先级
    const priority = isVbrMp3 ? priorityMap.mp3 : (priorityMap[ext] ?? 3);
    if (priority >= 3) continue;
    list.push({
      name: file.name,
      size: sizeToNum(file.size),
      priority,
      format: file.format,
    });
  }
  return list;
};

const selectBest = (candidates: FileCandidate[]): FileCandidate | null => {
  if (candidates.length === 0) return null;
  // 先按优先级升序，再按体积降序
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.size - a.size;
  });
  return candidates[0] ?? null;
};

const song_url: ArchiveModule = async (params) => {
  const trackId = String(params.trackId ?? "").trim();
  if (!trackId) return { code: 400, url: "", message: "trackId required" };
  const quality = typeof params.quality === "string" ? params.quality : undefined;
  const priorityMap = buildPriorityByQuality(quality);

  const url = `${ARCHIVE_API_BASE}/metadata/${encodeURIComponent(trackId)}`;

  try {
    const body = await archiveRequest<ArchiveMetadataResp>(url);
    const files = body.files ?? [];
    const candidates = buildCandidates(files, priorityMap);
    const best = selectBest(candidates);

    if (!best) {
      archiveLog.warn(
        `[ERR-13005-A] Archive 无可用音频文件: trackId=${trackId} files=${files.length}`,
      );
      return { code: 200, url: "", source: "archive" };
    }

    const downloadUrl =
      `${ARCHIVE_API_BASE}/download/` +
      `${encodeURIComponent(trackId)}/${encodeURIComponent(best.name)}`;

    archiveLog.info(
      `[ERR-13003-A] Archive metadata 命中: trackId=${trackId} file=${best.name} ` +
        `size=${best.size} format=${best.format ?? "?"} quality=${quality ?? "default"}`,
    );
    return { code: 200, url: downloadUrl, source: "archive" };
  } catch (err) {
    archiveLog.warn(`[ERR-13004-A] Archive metadata 拉取失败: trackId=${trackId}`, err);
    return { code: 200, url: "", source: "archive" };
  }
};

export default song_url;
