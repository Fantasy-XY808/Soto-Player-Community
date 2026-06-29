/**
 * 网易云账号级别查询
 *
 * 复用主进程 `callNetease` 直接打 `/api/w/nuser/account/get`（login_status 模块），
 * 解析 profile.vipType 判定级别。失败或未登录时返回 null。
 */

import { callNetease } from "@main/apis/netease";
import { ltLog } from "@main/utils/logger";
import type { ListenTogetherLocalUser } from "@shared/types/settings";
import type { UserLevel } from "./protocol";

/** login_status 响应中的关键字段 */
interface AccountResponse {
  code?: number;
  profile?: {
    nickname?: string;
    vipType?: number;
  } | null;
  account?: {
    id?: number;
  } | null;
}

export type LocalUserInfo = ListenTogetherLocalUser;

/**
 * 查询当前登录网易云账号的级别
 * @returns 级别信息；未登录或查询失败返回 null
 */
export const getLocalUserInfo = async (): Promise<LocalUserInfo | null> => {
  try {
    const res = await callNetease("login_status", {});
    const body = res.body as AccountResponse | { data?: AccountResponse };
    // login_status 模块把结果包了一层 data
    const account = (body as { data?: AccountResponse }).data ?? (body as AccountResponse);
    if (!account || account.code !== 200 || !account.profile) {
      ltLog.warn("查询登录态失败：未登录或响应异常");
      return null;
    }
    const vipType = account.profile.vipType ?? 0;
    return {
      name: account.profile.nickname ?? "未命名",
      level: vipType === 0 ? "default" : "vip",
    };
  } catch (err) {
    ltLog.error("查询登录态异常:", err);
    return null;
  }
};

/**
 * 比较客户端级别是否达到主机要求
 * @param clientLevel - 客户端级别
 * @param hostLevel - 主机级别
 * @returns true 表示客户端级别 ≥ 主机级别（可加入）
 */
export const isLevelSufficient = (clientLevel: UserLevel, hostLevel: UserLevel): boolean => {
  if (hostLevel === "default") return true;
  return clientLevel === "vip";
};
