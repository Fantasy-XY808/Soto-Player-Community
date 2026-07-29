/**
 * Bilibili API 通用常量
 *
 * 关键发现：
 * - 公开 API，搜索需要 buvid3 cookie（匿名占位值即可绕过）
 * - 搜索结果 title 含 <em class="keyword"> 高亮标签 + HTML 实体
 * - 视频元数据：/x/web-interface/view?bvid={bvid} 取 cid
 * - 取流：/x/player/playurl?bvid={bvid}&cid={cid}&fnval=16（DASH 格式）
 * - DASH audio[] 按 id 优先级排序（实地验证 + B站官方 opus 文章）：
 *   30251 (Hi-Res 192kHz/24bit FLAC) > 30250 (Dolby Audio 杜比) >
 *   30280 (192k AAC) > 30232 (132k AAC) > 30216 (64k AAC)
 * - 30251 是 Hi-Res 192kHz/24bit FLAC，需大会员 + 视频本身有 Hi-Res 音频；不可用时自动回落
 * - 30250 是 Dolby Audio 杜比音频，需大会员 + 视频含杜比音轨；老设备可能播放失败，排在 Hi-Res 之后
 *
 * 注意：B站音频来源不定，多数 UP 主转码后的有损/16bit FLAC，非真母带，UI 必须标注。
 */

/** Bilibili API base */
export const BILI_API_BASE = "https://api.bilibili.com";

/** 搜索 base */
export const BILI_SEARCH_BASE = "https://api.bilibili.com/x/web-interface/search/type";

/** 浏览器伪装 UA */
export const BILI_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 匿名 buvid3 cookie 占位值（B站对匿名搜索较宽松） */
export const BILI_ANON_COOKIE = "buvid3=placeholder";

/** HTML 实体反转义（B站搜索结果 title 含 <em class="keyword"> 高亮标签 + &amp; 实体） */
export const decodeName = (s: string | null | undefined): string => {
  if (!s) return "";
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
};
