/**
 * UnblockNeteaseMusic 解灰源 dispatcher
 *
 * 按 system.songUnlockServer 配置顺序尝试启用的解灰源，返回首个成功的 URL。
 * 单源查询接口供设置面板测试使用。
 */

import { store } from "@main/store";
import { unblockLog } from "@main/utils/logger";
import { getBodianSongUrl } from "./bodian";
import { getKuwoSongUrl } from "./kuwo";
import { getNeteaseSongUrl } from "./netease";
import type { SongMatchInfo, SongUrlResult, SongUnlockServerKey } from "./types";

/** 各源的处理器映射 */
const handlers: Record<SongUnlockServerKey, (m: SongMatchInfo) => Promise<SongUrlResult>> = {
  netease: getNeteaseSongUrl,
  kuwo: getKuwoSongUrl,
  bodian: getBodianSongUrl,
};

/**
 * 按配置顺序尝试解灰源，返回首个成功的 URL
 * @param match 歌曲匹配信息
 * @returns 首个成功的解灰结果；全部失败返回 code=404
 */
export const resolveUnblockUrl = async (match: SongMatchInfo): Promise<SongUrlResult> => {
  const servers = store.get("system.songUnlockServer") as
    | { key: SongUnlockServerKey; enabled: boolean }[]
    | undefined;
  const enabledServers = (servers ?? []).filter((s) => s.enabled).map((s) => s.key);
  for (const key of enabledServers) {
    const handler = handlers[key];
    if (!handler) continue;
    try {
      const result = await handler(match);
      if (result.code === 200 && result.url) {
        unblockLog.info(`解灰成功 [${key}]: ${result.url}`);
        return { ...result, from: key };
      }
    } catch (err) {
      unblockLog.warn(`解灰源 ${key} 异常:`, err);
    }
  }
  return { code: 404, url: null };
};

/**
 * 单源查询（用于设置面板测试）
 * @param key 源标识
 * @param match 歌曲匹配信息
 * @returns 该源的解灰结果
 */
export const queryUnblockSource = async (
  key: SongUnlockServerKey,
  match: SongMatchInfo,
): Promise<SongUrlResult> => {
  const handler = handlers[key];
  if (!handler) return { code: 404, url: null };
  const result = await handler(match);
  return { ...result, from: key };
};
