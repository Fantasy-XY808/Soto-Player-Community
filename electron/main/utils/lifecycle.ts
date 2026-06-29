import { app } from "electron";

/** 应用是否正在退出；退出流程中主窗口 close 不再走"隐藏到托盘"分支 */
let quitting = false;

app.once("before-quit", () => {
  quitting = true;
});

export const isAppQuitting = (): boolean => quitting;
