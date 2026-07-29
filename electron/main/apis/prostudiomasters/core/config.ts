/**
 * ProStudioMasters API 通用常量
 *
 * ProStudioMasters（prostudiomasters.com）是专业 Hi-Res 母带商店，
 * 提供 24bit/96kHz/192kHz 的 FLAC。
 *
 * 关键说明（Plan.md §1.5.4）：
 * - 平台未公开 API 文档，所有端点均需逆向工程获得（C 级）
 * - 试听：每首 2 分钟 MP3（约 64-128kbps），公开可匿名
 * - 完整流：需付费购买
 * - 与 Qobuz 目录重叠约 60%；签名算法变更需实地逆向
 *
 * 当前实现策略：
 * - 试听路径免登录：抓 https://www.prostudiomasters.com/search?q={kw} HTML
 *   + 解析 <audio>/<source>/data-preview-url 等公开标记提取 preview MP3 直链
 * - 付费登录用户：注入凭据后抓 track 页 HTML，若 PSM 网页登录态下
 *   展示完整 Hi-Res 流直链则自动捕获；否则回落到 2 分钟 MP3 试听
 * - 完整流 API 端点 URL 未公开，本模块不内置盲试循环（避免消耗超时预算）
 *
 * AGPL 合规：用户自带凭据访问自己付费的内容，应用只做 HTTP 代理
 *
 * 错误码段位：14XXX（mora 占 14XXX-A，prostudiomasters 占 14XXX-B；
 *             本模块日志统一使用 [ERR-1420X-A] 标识 PSM 相关事件）
 */

/**
 * 网页 base URL（www.prostudiomasters.com，用于 HTML 抓取）
 *
 * PSM 网页是 PHP 后端，HTML 内含曲目元数据，免登录可匿名抓取
 */
export const PSM_WEB_BASE = "https://www.prostudiomasters.com";

/** 浏览器伪装 UA（与 Qobuz 一致，避免被风控判为脚本） */
export const PSM_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** HTML 实体反转义（ProStudioMasters 标题偶尔含 `&amp;`、`&#039;` 等） */
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
