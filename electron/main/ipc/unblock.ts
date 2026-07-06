import { ipcMain } from "electron";
import { unblockLog } from "@main/utils/logger";
import { resolveUnblockUrl, queryUnblockSource } from "@main/apis/unblock";
import type { SongMatchInfo, SongUnlockServerKey } from "@main/apis/unblock/types";

/** 解灰相关 IPC */
export const registerUnblockIpc = (): void => {
  // 按配置顺序尝试启用的解灰源，返回首个成功的 URL
  ipcMain.handle("unblock:resolve", async (_event, match: SongMatchInfo) => {
    try {
      const result = await resolveUnblockUrl(match);
      return { success: true, data: result };
    } catch (err) {
      unblockLog.error("unblock:resolve 异常:", err);
      return { success: false, data: { code: 404, url: null } };
    }
  });

  // 单源查询（用于设置面板测试）
  ipcMain.handle("unblock:test", async (_event, key: SongUnlockServerKey, match: SongMatchInfo) => {
    try {
      const result = await queryUnblockSource(key, match);
      return { success: true, data: result };
    } catch (err) {
      unblockLog.error(`unblock:test [${key}] 异常:`, err);
      return { success: false, data: { code: 404, url: null } };
    }
  });
};
