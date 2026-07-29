/**
 * 2L API 通用常量
 *
 * 2L（Lindberg Lyd，挪威 Hi-Res 厂牌，2l.no）以高清录音闻名，
 * 官网在 /hires/ 路径下提供免费 Hi-Res 试听样品专辑下载
 * （DXD 24bit/352.8kHz、DSD64/DSD128、24bit/96/192kHz FLAC）。
 *
 * 关键说明：
 * - 2L 是免费样品，无需登录（与 mora/psm 的付费登录模式不同）
 * - /hires/index.html 是静态 HTML 文件列表，含 <a href="*.flac|*.dsf|*.dff|*.wav"> 直链
 * - 仅个人试听模式：试听曲目不可加入曲库收录
 *
 * 错误码段位：14XXX（mora 占 14XXX-A，prostudiomasters 占 14XXX-B，2L 占 14XXX-C）
 */

/** API base URL（2l.no） */
export const TWO_L_API_BASE = "https://www.2l.no";

/** 试听样品索引页（静态 HTML，包含 FLAC/DXD/DSD 直链） */
export const TWO_L_SAMPLE_INDEX = "/hires/index.html";

/** 浏览器伪装 UA（与 Qobuz/mora 一致，避免被风控判为脚本） */
export const TWO_L_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** HTML 实体反转义（2L 标题偶尔含 `&amp;`、`&#039;` 等） */
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
