/**
 * Internet Archive API 通用常量
 *
 * API 文档：https://archive.org/advancedsearch.php
 * 关键发现：
 * - 公开 API，完全无鉴权，无需 X-App-Id / token / signature
 * - advancedsearch.php 返回 identifier 列表 + 元数据片段（按 fl[] 指定字段）
 * - /metadata/{identifier} 返回完整 files 数组与 metadata
 * - 下载 URL：https://archive.org/download/{identifier}/{filename}
 * - etree 集合是现场录音（live recordings），多为 allowlist 派生格式
 *
 * 错误码段位：13XXX（与 mora / 2L 共享，archive 占 13001-13006）
 */

/** API base URL */
export const ARCHIVE_API_BASE = "https://archive.org";

/** 浏览器伪装 UA（与 Qobuz 一致，避免被风控判为脚本） */
export const ARCHIVE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** HTML 实体反转义（archive.org 标题偶尔含 `&amp;`、`&#039;` 等） */
const ENTITY_MAP: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#039;": "'",
};

export const decodeName = (str: string | null | undefined): string => {
  if (!str) return "";
  return str.replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&apos;|&#039;/g, (s) => ENTITY_MAP[s] ?? s);
};
