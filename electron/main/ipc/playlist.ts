import fs from "node:fs/promises";
import path from "node:path";
import { app, dialog, ipcMain, BrowserWindow } from "electron";
import { systemLog } from "@main/utils/logger";

/** 文件后缀 → 对话框 filter 名 */
const FILTER_MAP: Record<string, { name: string; extensions: string[] }> = {
  json: { name: "JSON", extensions: ["json"] },
  m3u: { name: "M3U 播放列表", extensions: ["m3u", "m3u8"] },
  csv: { name: "CSV 表格", extensions: ["csv"] },
};

/** 文件名安全化：去掉非法字符，截断长度 */
const sanitizeFileName = (name: string): string => {
  const trimmed = (name ?? "").trim() || "未命名歌单";
  return trimmed.replace(/[\\/:*?"<>|]/g, " ").slice(0, 100);
};

/** 注册歌单导入导出 IPC */
export const registerPlaylistIpc = (): void => {
  /**
   * 导出歌单到文件
   *
   * @param _event
   * @param defaultName 默认文件名（不含后缀）
   * @param content 文件内容
   * @param format 格式：json / m3u / csv
   */
  ipcMain.handle(
    "playlist:export",
    async (
      _event,
      defaultName: string,
      content: string,
      format: "json" | "m3u" | "csv",
    ): Promise<{ success: boolean; path?: string; reason?: "canceled" | "writeFailed" }> => {
      const filter = FILTER_MAP[format] ?? FILTER_MAP.json;
      const baseName = sanitizeFileName(defaultName);
      const defaultPath = path.join(app.getPath("documents"), `${baseName}.${format}`);
      const win = BrowserWindow.getFocusedWindow();
      const opts: Electron.SaveDialogOptions = {
        title: "导出歌单",
        defaultPath,
        filters: [filter],
      };
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts);
      if (result.canceled || !result.filePath) return { success: false, reason: "canceled" };
      try {
        await fs.writeFile(result.filePath, content, "utf-8");
        systemLog.info(`[playlist] exported to ${result.filePath}`);
        return { success: true, path: result.filePath };
      } catch (err) {
        systemLog.error("[playlist] export failed", err);
        return { success: false, reason: "writeFailed" };
      }
    },
  );

  /**
   * 导入歌单文件
   *
   * 弹出文件选择对话框，返回文件内容与文件名
   * 渲染端拿到内容后调用 parsePlaylist 解析
   */
  ipcMain.handle(
    "playlist:import",
    async (): Promise<{
      success: boolean;
      content?: string;
      filename?: string;
      reason?: "canceled" | "readFailed";
    }> => {
      const win = BrowserWindow.getFocusedWindow();
      const opts: Electron.OpenDialogOptions = {
        title: "导入歌单",
        properties: ["openFile"],
        filters: [
          { name: "播放列表文件", extensions: ["json", "m3u", "m3u8", "csv"] },
          { name: "JSON", extensions: ["json"] },
          { name: "M3U 播放列表", extensions: ["m3u", "m3u8"] },
          { name: "CSV 表格", extensions: ["csv"] },
          { name: "所有文件", extensions: ["*"] },
        ],
      };
      const result = win
        ? await dialog.showOpenDialog(win, opts)
        : await dialog.showOpenDialog(opts);
      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, reason: "canceled" };
      }
      const filePath = result.filePaths[0];
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const filename = path.basename(filePath);
        return { success: true, content, filename };
      } catch (err) {
        systemLog.error("[playlist] import read failed", err);
        return { success: false, reason: "readFailed" };
      }
    },
  );
};
