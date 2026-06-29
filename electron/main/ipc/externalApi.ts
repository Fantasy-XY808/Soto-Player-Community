/**
 * 外部 API 服务相关 IPC
 *
 * - restart：重启服务并返回新状态（端口占用/错误经 ExternalApiStatus.error 暴露）
 * - getStatus：查询当前运行状态（面板挂载时拉一次）
 */

import { ipcMain } from "electron";
import { restartServer, getServerStatus } from "@main/server";

export const registerExternalApiIpc = (): void => {
  ipcMain.handle("externalApi:restart", () => restartServer());
  ipcMain.handle("externalApi:getStatus", () => getServerStatus());
};
