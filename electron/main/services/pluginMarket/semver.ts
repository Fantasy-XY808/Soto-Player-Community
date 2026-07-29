/**
 * 语义化版本工具
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

/** 解析语义化版本字符串 */
export const parseVersion = (version: string): ParsedVersion => {
  const cleaned = version.replace(/^v/, "").trim();
  const match = cleaned.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?(?:\+([a-zA-Z0-9.]+))?$/);
  if (!match) {
    return { major: 0, minor: 0, patch: 0 };
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4],
    build: match[5],
  };
};

/** 比较两个预发布标识符 */
const comparePrerelease = (a: string | undefined, b: string | undefined): number => {
  // 无预发布 > 有预发布
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const aParts = a.split(".");
  const bParts = b.split(".");
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aPart = aParts[i];
    const bPart = bParts[i];
    if (aPart === undefined) return -1;
    if (bPart === undefined) return 1;

    const aNum = parseInt(aPart, 10);
    const bNum = parseInt(bPart, 10);
    const aIsNum = !isNaN(aNum) && aPart === String(aNum);
    const bIsNum = !isNaN(bNum) && bPart === String(bNum);

    if (aIsNum && bIsNum) {
      if (aNum !== bNum) return aNum < bNum ? -1 : 1;
    } else if (aIsNum) {
      return -1; // 数字 < 字符串
    } else if (bIsNum) {
      return 1;
    } else {
      if (aPart !== bPart) return aPart < bPart ? -1 : 1;
    }
  }
  return 0;
};

/** 比较两个语义化版本，返回 -1/0/1 */
export const compareSemver = (a: string, b: string): number => {
  const va = parseVersion(a);
  const vb = parseVersion(b);

  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;

  return comparePrerelease(va.prerelease, vb.prerelease);
};

/** 检查是否有更新可用 */
export const isUpdateAvailable = (current: string, latest: string): boolean => {
  return compareSemver(current, latest) < 0;
};

/** 检查版本是否满足指定范围（支持 ^ 和 ~） */
export const satisfiesRange = (version: string, range: string): boolean => {
  const v = parseVersion(version);
  const trimmed = range.trim();

  if (trimmed === "*") return true;

  if (trimmed.startsWith("^")) {
    const r = parseVersion(trimmed.slice(1));
    if (v.major !== r.major) return false;
    if (v.major === 0 && v.minor !== r.minor) return false;
    if (compareSemver(version, trimmed.slice(1)) < 0) return false;
    return true;
  }

  if (trimmed.startsWith("~")) {
    const r = parseVersion(trimmed.slice(1));
    if (v.major !== r.major) return false;
    if (v.minor !== r.minor) return false;
    if (compareSemver(version, trimmed.slice(1)) < 0) return false;
    return true;
  }

  return compareSemver(version, trimmed) === 0;
};
