/**
 * mora API 通用常量
 *
 * mora（mora.jp）是日本索尼旗下 Hi-Res 商店，jQuery + 服务端渲染传统网页。
 *
 * 真实接口（经实地抓包验证，2026-07-11）：
 * - 搜索接口：https://mora.jp/search/getResult?keyWord={kw}
 *   返回 JSON：{ head: { successFlg: "1" }, data: { trackResult: { list: [...] } } }
 *   每个 track 含字段：materialNo / trackTitle / artistName / packageTitle /
 *   packageId / packagePage / artistPage / weblistsizeimage / duration / listenFlg /
 *   mediaFormatNo / samplingFreq / bitPerSample / price 等
 *
 * - 试听接口：https://mora.jp/listenDownload?materialNo={materialNo}
 *   返回 JSON：{ listenUrl: "https://cf-priv.mora.jp/.../xxx.320.mp4?Policy=...&Signature=..." }
 *   listenUrl 是签名 CloudFront URL，扩展名 .mp4，AAC 320kbps in MP4 容器，有时效（约 24h）
 *
 * 试听路径免登录；完整流 D 级不接入（下载商店无流媒体能力）
 */

/** API base URL（mora.jp） */
export const MORA_API_BASE = "https://mora.jp";

/** 搜索接口路径（返回 JSON） */
export const MORA_SEARCH_PATH = "/search/getResult";

/** 试听接口路径（返回 JSON，含签名 listenUrl） */
export const MORA_LISTEN_PATH = "/listenDownload";

/** 浏览器伪装 UA（与 Qobuz 一致，避免被风控判为脚本） */
export const MORA_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** mediaFormatNo 枚举：媒体格式编号（实地抓包验证） */
export const MORA_MEDIA_FORMAT = {
  /** AAC-LC 320kbps 音乐 */
  AAC_MUSIC: 10,
  /** AVC/H.264 视频 */
  VIDEO: 11,
  /** Hi-Res FLAC */
  FLAC_HIRES: 12,
  /** DSD */
  DSD: 13,
  /** Lossless FLAC */
  FLAC_LOSSLESS: 15,
} as const;

/** HTML 实体反转义（mora 标题偶尔含 `&amp;`、`&#039;` 等） */
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
