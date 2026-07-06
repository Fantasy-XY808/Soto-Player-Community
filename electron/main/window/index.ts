import { store } from "@main/store";
import { isWin } from "@main/utils/config";
import { createDesktopLyricWindow } from "./desktopLyric";
import { createDynamicIslandWindow, applyDynamicIslandAutoStart } from "./dynamicIsland";
import { createTaskbarLyricWindow } from "./taskbarLyric";

export { createWindow } from "./create";
export {
  createMainWindow,
  getMainWindow,
  focusMainWindow,
  setTaskbarProgress,
  applyMainWindowZoom,
  minimizeMainWindow,
  toggleMaximizeMainWindow,
  isMainWindowMaximized,
  toggleFullscreenMainWindow,
  isMainWindowFullscreen,
  hideMainWindow,
} from "./main";
export {
  createDesktopLyricWindow,
  closeDesktopLyricWindow,
  toggleDesktopLyricWindow,
  getDesktopLyricWindow,
  applyDesktopLyricLock,
  applyDesktopLyricAlwaysOnTop,
  applyDesktopLyricMouseIgnore,
  applyDesktopLyricHeight,
  moveDesktopLyricWindow,
  saveDesktopLyricState,
} from "./desktopLyric";
export {
  createDynamicIslandWindow,
  closeDynamicIslandWindow,
  toggleDynamicIslandWindow,
  getDynamicIslandWindow,
  applyDynamicIslandAlwaysOnTop,
  applyDynamicIslandHeight,
  applyDynamicIslandWidth,
  applyDynamicIslandBounds,
  applyDynamicIslandSnapCentered,
  applyDynamicIslandHorizontalOffset,
  applyDynamicIslandNotchFusion,
  applyDynamicIslandNonOcclusive,
  applyDynamicIslandSuppressFullscreen,
  applyDynamicIslandAutoStart,
  moveDynamicIslandWindow,
  saveDynamicIslandState,
} from "./dynamicIsland";
export {
  createTaskbarLyricWindow,
  closeTaskbarLyricWindow,
  toggleTaskbarLyricWindow,
  getTaskbarLyricWindow,
  applyTaskbarLyricLayout,
} from "./taskbarLyric";

/** 恢复歌词相关窗口 */
export const restoreLyricWindows = (): void => {
  if (store.get("windowStates.desktopLyric.visible")) createDesktopLyricWindow();
  if (store.get("windowStates.dynamicIsland.visible")) createDynamicIslandWindow();
  if (isWin && store.get("windowStates.taskbarLyric.visible")) {
    createTaskbarLyricWindow();
  }
  // 同步灵动岛开机自启设置到系统（不依赖窗口可见，每次启动都同步）
  applyDynamicIslandAutoStart(store.get("dynamicIsland").autoStart);
};
