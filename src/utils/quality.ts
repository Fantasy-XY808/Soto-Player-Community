import type { AudioQuality } from "@shared/types/player";

/**
 * 音质等级（从高到低）
 * jyeffect/sky/jymaster 为网易云 VIP 专属环绕/母带档位
 */
export type QualityLevel =
  | "jymaster"
  | "sky"
  | "jyeffect"
  | "hi-res"
  | "lossless"
  | "hq"
  | "sq"
  | "lq";

/** 无损编解码器 */
const LOSSLESS_CODECS = new Set(["flac", "alac", "ape", "wav", "aiff", "wavpack", "tta"]);

/** Dolby Atmos 编解码器（jyeffect 档位） */
const ATMOS_CODECS = new Set(["ec3", "eac3", "atmos"]);

/** Sky 沉浸式音频编解码器（MPEG-H 3D Audio） */
const SKY_CODECS = new Set(["mha1", "mhm1"]);

/** 网易云 level 字段 → QualityLevel 映射 */
const NETEASE_LEVEL_MAP: Record<string, QualityLevel> = {
  standard: "lq",
  higher: "sq",
  exhigh: "hq",
  lossless: "lossless",
  hires: "hi-res",
  jyeffect: "jyeffect",
  sky: "sky",
  jymaster: "jymaster",
};

/** 等级短码文案 */
export const QUALITY_LABELS: Record<QualityLevel, string> = {
  jymaster: "Master",
  sky: "Sky",
  jyeffect: "Atmos",
  "hi-res": "Hi-Res",
  lossless: "Lossless",
  hq: "HQ",
  sq: "SQ",
  lq: "LQ",
};

/** 等级完整文案 */
const QUALITY_FULL_LABELS: Record<QualityLevel, string> = {
  jymaster: "Master (24bit/192kHz)",
  sky: "Sky (Immersive)",
  jyeffect: "Atmos (Dolby)",
  "hi-res": "Hi-Res",
  lossless: "Lossless",
  hq: "High Quality",
  sq: "Standard Quality",
  lq: "Low Quality",
};

/** 等级权重，用于权限比较（值越大权限要求越高） */
export const QUALITY_RANK: Record<QualityLevel, number> = {
  lq: 0,
  sq: 1,
  hq: 2,
  lossless: 3,
  "hi-res": 4,
  jyeffect: 5,
  sky: 6,
  jymaster: 7,
};

/**
 * 判断音质等级；优先用服务器声明 level，其次按物理参数推断
 * @param quality - AudioQuality；undefined / 无 codec 时按最低档处理
 * @returns 音质等级
 */
export const getQualityLevel = (quality: AudioQuality | undefined): QualityLevel => {
  if (!quality) return "lq";
  // 优先用服务器声明的 level（网易云 level 字段最准确）
  if (quality.level && NETEASE_LEVEL_MAP[quality.level]) {
    return NETEASE_LEVEL_MAP[quality.level];
  }
  if (!quality.codec || quality.codec === "unknown") return "lq";
  const codecLower = quality.codec.toLowerCase();
  // Atmos / Sky 专属编解码器优先识别
  if (ATMOS_CODECS.has(codecLower)) return "jyeffect";
  if (SKY_CODECS.has(codecLower)) return "sky";
  const isLossless = LOSSLESS_CODECS.has(codecLower);
  if (isLossless) {
    // jymaster 母带：96kHz/24bit 及以上即视为母带（网易云 jymaster 实际多为 96kHz/24bit）
    if (quality.sampleRate >= 96000 && quality.bitsPerSample >= 24) return "jymaster";
    if (quality.sampleRate >= 48000 && quality.bitsPerSample >= 24) return "hi-res";
    return "lossless";
  }
  const kbps = quality.bitRate / 1000;
  if (kbps >= 320) return "hq";
  if (kbps >= 192) return "sq";
  return "lq";
};

/**
 * 取音质等级短码文案
 * @param quality - AudioQuality；未知时返回空串（避免加载中误显示 LQ）
 * @returns 短码文案
 */
export const getQualityLabel = (quality: AudioQuality | undefined): string =>
  quality ? QUALITY_LABELS[getQualityLevel(quality)] : "";

/**
 * 取音质等级完整文案
 * @param quality - AudioQuality；未知时返回空串
 * @returns 完整文案
 */
export const getQualityFullLabel = (quality: AudioQuality | undefined): string =>
  quality ? QUALITY_FULL_LABELS[getQualityLevel(quality)] : "";

/** 是否为无损级别（hi-res / lossless / jyeffect / sky / jymaster） */
export const isLosslessQuality = (quality: AudioQuality | undefined): boolean => {
  const level = getQualityLevel(quality);
  return (
    level === "hi-res" ||
    level === "lossless" ||
    level === "jyeffect" ||
    level === "sky" ||
    level === "jymaster"
  );
};

/** VIP 专属档位（lossless 及以上） */
const VIP_ONLY_LEVELS: ReadonlySet<QualityLevel> = new Set<QualityLevel>([
  "lossless",
  "hi-res",
  "jyeffect",
  "sky",
  "jymaster",
]);

/**
 * 判断指定档位是否需要 VIP
 * @param level - 音质档位
 */
export const isVipOnlyLevel = (level: QualityLevel): boolean => VIP_ONLY_LEVELS.has(level);

/**
 * 取当前用户可用的音质档位列表（按从低到高排序）
 * @param isLoggedIn - 是否已登录网易云
 * @param isVip - 是否为 VIP（vipType !== 0）
 * @returns 可用档位列表
 */
export const getAllowedQualityLevels = (isLoggedIn: boolean, isVip: boolean): QualityLevel[] => {
  // 未登录：仅 standard（128k）
  if (!isLoggedIn) return ["lq"];
  // 已登录非 VIP：lq/sq/hq
  if (!isVip) return ["lq", "sq", "hq"];
  // VIP：全部 8 档
  return ["lq", "sq", "hq", "lossless", "hi-res", "jyeffect", "sky", "jymaster"];
};

/**
 * 把档位限制到用户可用范围内
 * @param level - 用户选择的档位
 * @param isLoggedIn - 是否已登录
 * @param isVip - 是否 VIP
 * @returns 实际可用的档位（不可用时回落到最高可用档）
 */
export const clampQualityLevel = (
  level: QualityLevel,
  isLoggedIn: boolean,
  isVip: boolean,
): QualityLevel => {
  const allowed = getAllowedQualityLevels(isLoggedIn, isVip);
  if (allowed.includes(level)) return level;
  // 回落到不超过 level 的最高可用档
  const targetRank = QUALITY_RANK[level];
  const fallback = allowed
    .filter((l) => QUALITY_RANK[l] <= targetRank)
    .sort((a, b) => QUALITY_RANK[b] - QUALITY_RANK[a]);
  return fallback[0] ?? "lq";
};
