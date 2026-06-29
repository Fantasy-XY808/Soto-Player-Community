import { ipcMain } from "electron";
import { hasLegacyData, performMigration } from "@main/services/migration";

/** 注册数据迁移相关 IPC */
export const registerMigrationIpc = (): void => {
  // 检测旧 SPlayer-Next 数据是否存在
  ipcMain.handle("migration:hasLegacyData", () => hasLegacyData());

  // 执行迁移：把旧数据复制到当前位置（覆盖）
  ipcMain.handle(
    "migration:perform",
    async (): Promise<{ ok: boolean; migrated: string[]; error?: string }> => {
      return performMigration();
    },
  );
};
