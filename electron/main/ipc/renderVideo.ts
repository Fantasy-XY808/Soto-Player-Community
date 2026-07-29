/**
 * 视频渲染 IPC
 *
 * 主窗口 → renderVideo:start / cancel / list / pickDir → renderVideoManager
 * 渲染窗口 → renderVideo:chunk / progress / finished / error / captureFrame → renderVideoManager
 */

import { ipcMain } from "electron";
import * as manager from "@main/services/renderVideoManager";
import { getVideoRendererWindow } from "@main/window/videoRenderer";
import { renderVideoLog } from "@main/utils/logger";
import type { RenderVideoRequest } from "@shared/types/renderVideo";

export const registerRenderVideoIpc = (): void => {
  ipcMain.handle("renderVideo:start", (_evt, req: RenderVideoRequest) => manager.start(req));
  ipcMain.handle("renderVideo:cancel", (_evt, taskId: string) => manager.cancel(taskId));
  ipcMain.handle("renderVideo:list", () => manager.list());
  ipcMain.handle("renderVideo:getDir", () => manager.getRenderDir());
  ipcMain.handle("renderVideo:setDir", (_evt, dir: string) => manager.setDir(dir));
  ipcMain.handle("renderVideo:pickDir", () => manager.pickDir());

  // 分片：data 为 ArrayBuffer
  ipcMain.on("renderVideo:chunk", (_evt, taskId: string, data: ArrayBuffer, final: boolean) => {
    manager.handleChunk(taskId, data, final);
  });
  // 进度更新
  ipcMain.on("renderVideo:progress", (_evt, taskId: string, renderedMs: number) => {
    manager.handleProgress(taskId, renderedMs);
  });
  // 当前曲目渲染完成
  ipcMain.on("renderVideo:finished", (_evt, taskId: string) => {
    manager.handleFinished(taskId);
  });
  // 渲染错误
  ipcMain.on("renderVideo:error", (_evt, taskId: string, message: string) => {
    manager.handleError(taskId, message);
  });
  // 渲染窗口就绪信号（onConfig/onCancel 已订阅，可以下发 config 了）
  ipcMain.on("renderVideo:ready", () => {
    manager.handleReady();
  });

  // 渲染窗口请求主进程捕获当前画面（用于把 FullPlayer 真实 DOM 渲染喂给 MediaRecorder）
  // 主进程调用 webContents.capturePage() 取得 NativeImage，转换为 PNG data URL 返回
  // 渲染窗口拿到后 drawImage 到隐藏 canvas，由 canvas.captureStream 生成视频流
  ipcMain.handle("renderVideo:captureFrame", async (): Promise<string> => {
    const win = getVideoRendererWindow();
    if (!win || win.isDestroyed()) {
      renderVideoLog.warn("[ERR-70010-C] captureFrame 失败：渲染窗口不存在");
      return "";
    }
    try {
      const image = await win.webContents.capturePage();
      if (image.isEmpty()) {
        renderVideoLog.warn("[ERR-70006-I] capturePage 返回空图像");
        return "";
      }
      return image.toDataURL();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      renderVideoLog.error(`[ERR-70006-J] capturePage 异常: ${message}`);
      return "";
    }
  });
};
