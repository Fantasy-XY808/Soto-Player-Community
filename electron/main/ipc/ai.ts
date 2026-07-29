/**
 * AI 模型配置 IPC
 *
 * - list：列出已配置的 AI 模型（不含密钥明文）
 * - save：新增或编辑模型配置（apiKey 经 safeStorage 加密后落盘）
 * - remove：删除指定模型
 * - setActive：切换当前激活的模型
 */

import { ipcMain } from "electron";
import type { AiModelSaveInput } from "@shared/types/settings";
import {
  listAiModels,
  removeAiModel,
  saveAiModel,
  setActiveAiModel,
} from "@main/services/ai/model";

/** 注册 AI 模型配置 IPC */
export const registerAiIpc = (): void => {
  ipcMain.handle("ai:listModels", () => listAiModels());
  ipcMain.handle("ai:saveModel", (_event, input: AiModelSaveInput) => saveAiModel(input));
  ipcMain.handle("ai:removeModel", (_event, id: string) => removeAiModel(id));
  ipcMain.handle("ai:setActiveModel", (_event, id: string | null) => setActiveAiModel(id));
};
