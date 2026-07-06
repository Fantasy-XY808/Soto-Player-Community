/**
 * Camelot Wheel 调式兼容性工具
 *
 * 把音乐调式映射到 Camelot 编号（如 C major → 8B），同一编号或相邻编号（±1，同字母）
 * 之间相互兼容，DJ 混音时能保持调性连贯。
 */

/** 调式类型 */
export type KeyMode = "major" | "minor";

/** 调式解析结果 */
export interface ParsedKey {
  /** 主音（音名，大写字母，如 "C"、"C#"、"A"） */
  tonic: string;
  /** 大调 / 小调 */
  mode: KeyMode;
  /** Camelot 编号（1-12） */
  camelotNumber: number;
  /** Camelot 字母（B=大调，A=小调） */
  camelotLetter: "A" | "B";
}

/** 主音 → 半音偏移（相对 C） */
const TONIC_SEMITONE: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

/** 大调 Camelot 编号（按半音偏移索引） */
const MAJOR_CAMELOT = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
/** 小调 Camelot 编号（按半音偏移索引） */
const MINOR_CAMELOT = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

/**
 * 解析音频分析返回的调式字符串
 * @param raw - 形如 "C major"、"A minor"、"F# major"、"" 的字符串
 * @returns 解析结果；空字符串或无法识别时返回 null
 */
export const parseKey = (raw: string): ParsedKey | null => {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 兼容 "C major" / "Cmajor" / "C maj" / "C-major" 等
  const match = trimmed.match(/^([A-G][#b]?)[\s-]*(major|minor|maj|min|M|m)?$/i);
  if (!match) return null;
  const tonic = match[1];
  const modeRaw = (match[2] ?? "").toLowerCase();
  const mode: KeyMode =
    modeRaw === "minor" || modeRaw === "min" || modeRaw === "m" ? "minor" : "major";

  const semitone = TONIC_SEMITONE[tonic];
  if (semitone === undefined) return null;

  const camelotNumber = mode === "major" ? MAJOR_CAMELOT[semitone] : MINOR_CAMELOT[semitone];
  return {
    tonic,
    mode,
    camelotNumber,
    camelotLetter: mode === "major" ? "B" : "A",
  };
};

/**
 * 计算两个调式之间的兼容度距离
 * @returns 0=完全相同；1=相邻兼容；2=同字母同编号差 ±2；>2 不兼容
 */
export const camelotDistance = (a: ParsedKey | null, b: ParsedKey | null): number => {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  if (a.camelotNumber === b.camelotNumber && a.camelotLetter === b.camelotLetter) return 0;
  // 同字母 ±1 兼容
  if (a.camelotLetter === b.camelotLetter) {
    const diff = Math.abs(a.camelotNumber - b.camelotNumber);
    if (diff === 1 || diff === 11) return 1; // 12 与 1 相邻
    return diff + 1;
  }
  // 同编号大小调互换（如 8A ↔ 8B）：相对兼容
  if (a.camelotNumber === b.camelotNumber) return 1;
  return 5;
};

/**
 * 把 ParsedKey 转回 Camelot 字符串（如 "8B"）
 */
export const toCamelotString = (key: ParsedKey): string =>
  `${key.camelotNumber}${key.camelotLetter}`;
