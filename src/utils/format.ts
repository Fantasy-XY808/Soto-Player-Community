/** 格式化文件大小（字节 → 可读字符串） */
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

/**
 * 按 locale 紧凑展示一个数字，如 `9.9万` / `9.9M`
 * @param value - 原值，非有限数返回空串
 * @param locale - BCP-47 locale，如 "zh-CN" / "en-US"
 */
export const formatCompact = (value: number | undefined | null, locale: string): string => {
  if (value == null || !Number.isFinite(value)) return "";
  try {
    return new Intl.NumberFormat(locale, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return String(value);
  }
};
