/**
 * Wayback Machine 历史快照兜底
 *
 * 2L 官网 /hires/index.html 偶尔因官方维护下线（HTML 含 "test bench" +
 * "not available" / "has served its purpose" 等文案）。本模块从 Wayback Machine
 * 抓取历史快照 HTML，复用 search.ts 的解析逻辑（正则扫描 FLAC/DXD/DSD 直链）。
 *
 * Wayback URL 选择：https://web.archive.org/web/2024/{原 URL}
 * - /web/{year}/ 重定向到该年最接近 1 月 1 日的快照
 * - 选 2024：覆盖 2L Test Bench 多次下线窗口（2024-2025 期间维护），且早于
 *   当前维护期的快照基本是页面正常时的版本
 *
 * Wayback URL 重写：
 * - Wayback 会把 HTML 中的相对/绝对 URL 改写为 /web/{timestamp}/{原 URL} 形式
 * - search.ts 的 absolutize 已扩展为识别 /web/{digits}/ 前缀，补全为
 *   https://web.archive.org 开头的绝对 URL，原解析逻辑无需改动
 */

import { twoLLog } from "@main/utils/logger";
import { twoLRequestText } from "./request";

/** Wayback Machine 历史快照 URL（2024 年最近快照，重定向到 Jan 1 2024 附近的快照） */
const WAYBACK_URL = "https://web.archive.org/web/2024/https://www.2l.no/hires/index.html";

/** Wayback Machine 站点域名（用于 search.ts 的 absolutize 补全 /web/{ts}/ 前缀） */
export const WAYBACK_ORIGIN = "https://web.archive.org";

/**
 * 检测 2L Test Bench 是否下线
 *
 * 命中条件：HTML 含 "test bench" 关键字 + 任一维护文案：
 * - "not available"
 * - "has served its purpose"
 * - "no longer available"
 * - "maintenance"
 *
 * 比原 search.ts 的 TEST_BENCH_OFF_RE 更宽松（不限定两段文案距离 80 字符内），
 * 覆盖近年官方变更的多种表述，避免漏检。
 *
 * @param html  2L /hires/index.html 抓取到的原始 HTML
 */
export const isTestBenchOffline = (html: string): boolean => {
  const lower = (html ?? "").toLowerCase();
  return lower.includes("test bench") && (
    lower.includes("not available") ||
    lower.includes("has served its purpose") ||
    lower.includes("no longer available") ||
    lower.includes("maintenance")
  );
};

/**
 * 从 Wayback Machine 拿 2024 年历史快照 HTML
 *
 * Wayback 较慢，超时设 15s（主流程默认 8s 经常不够）。
 * 返回 null 表示兜底失败，上层应继续走原 fallback 逻辑（返回空结果）。
 *
 * 防御：快照本身也可能命中下线文案（snapshot 拍摄时正好下线），此时也放弃。
 *
 * @returns 历史快照 HTML（含 Wayback toolbar 注入），失败返回 null
 */
export const fetchWaybackHtml = async (): Promise<string | null> => {
  try {
    twoLLog.info("[2L] Test Bench 离线，尝试 Wayback Machine 历史快照");
    const html = await twoLRequestText(WAYBACK_URL, {
      signal: AbortSignal.timeout(15000),
    });
    if (!html || html.length < 1000) {
      twoLLog.warn("[2L] Wayback Machine 返回空或过短");
      return null;
    }
    if (isTestBenchOffline(html)) {
      twoLLog.warn("[2L] Wayback Machine 快照本身也命中下线文案，放弃");
      return null;
    }
    twoLLog.info(`[2L] Wayback Machine 历史快照获取成功 (${html.length} bytes)`);
    return html;
  } catch (err) {
    twoLLog.warn(`[2L] Wayback Machine 获取失败: ${err}`);
    return null;
  }
};
