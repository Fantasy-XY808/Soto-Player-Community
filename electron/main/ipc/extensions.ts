/**
 * 扩展点 IPC
 *
 * - 主进程订阅所有 12 Registry 的 subscribe，version 变化时广播给所有渲染端
 * - 渲染端通过 `extensions:subscribe` 订阅，收到变更后重新拉取列表
 * - 渲染端通过 `extensions:list` 主动拉取当前所有条目
 *
 * 注：日志直接走 console，避免引入 @main/utils/logger 的依赖链
 * （logger → config → @main/store + electron），后者无法在 tsx 测试环境中解析。
 */
import { createRequire } from "node:module";
import { ALL_REGISTRIES } from "../../../shared/extensions/registries";

// electron 是 CommonJS 模块，ESM 命名导入在 tsx 中失败（"does not provide an export named"）。
// 用 createRequire 做 CJS interop，同时兼容 tsx 测试与 electron-vite 构建。
const require = createRequire(import.meta.url);
const { ipcMain, BrowserWindow } = require("electron") as typeof import("electron");

const broadcastExtensions = (): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("extensions:changed", {});
    }
  }
};

export const registerExtensionsIpc = (): void => {
  for (const { name, registry } of ALL_REGISTRIES) {
    registry.subscribe(() => {
      console.debug(`[extensions-ipc] Registry ${name} changed, broadcasting`);
      broadcastExtensions();
    });
  }

  ipcMain.handle("extensions:list", () => {
    const result: Record<string, { id: string; pluginId: string; priority: number; metadata?: Record<string, unknown> }[]> = {};
    for (const { name, registry } of ALL_REGISTRIES) {
      result[name] = registry.listDescriptors().map((d) => ({
        id: d.id,
        pluginId: d.pluginId,
        priority: d.priority,
        metadata: d.metadata,
      }));
    }
    return result;
  });

  ipcMain.handle("extensions:subscribe", (event) => {
    event.sender.send("extensions:changed", {});
  });
};
