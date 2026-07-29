/**
 * 透明窗口降级服务
 *
 * 背景：
 * - Electron BrowserWindow 的 `transparent` 选项只能在创建时指定，运行时无法修改
 * - 省电模式 reduceTransparentWindow 降级项需要"关闭透明窗口"以节省 GPU 合成开销
 * - 因此降级策略是：进入省电模式时主动关闭桌面歌词/灵动岛/任务栏歌词三个透明窗口，
 *   并通过模块级标志阻止它们的后续重建；离开省电模式时清除标志并按用户持久化的
 *   visible 状态恢复窗口（restoreLyricWindows 已有逻辑）
 *
 * 设计要点：
 * - 单例：模块级 suppressed 标志 + listeners
 * - syncTransparentWindowSuppression 同步入口：按当前 isPowerSave + 用户设置
 *   决定是否进入/退出降级；状态未变化时直接返回避免重复关闭/恢复
 * - reapplyTransparentWindowSuppression 异步入口：用户修改设置后强制重新评估
 *   （从 powerState 缓存读取最新 isPowerSave 再走 sync 路径）
 */
import type { PowerSaveSettings } from "@shared/types/settings";
import { store } from "@main/store";
import { isWin } from "@main/utils/config";
import { systemLog } from "@main/utils/logger";
import {
  closeDesktopLyricWindow,
  closeDynamicIslandWindow,
  closeTaskbarLyricWindow,
  restoreLyricWindows,
} from "@main/window";
import { getCachedPowerState } from "@main/services/powerState";

/** 当前是否处于降级状态（模块级单例） */
let suppressed = false;

/**
 * 读取当前 powerSave 设置
 *
 * 注意路径：主进程 store 是 SystemConfig 直接对象（含 player/media/.../system 等字段），
 * 不像渲染端有外层 system 包装；因此 powerSave 路径是单层 system.powerSave
 */
const readPowerSaveSettings = (): PowerSaveSettings => {
  return store.get("system.powerSave") as PowerSaveSettings;
};

/**
 * 按当前 isPowerSave + 用户设置判定是否应进入降级
 *
 * 与渲染端 usePowerSave 的 isPowerSaveMode 逻辑保持一致：
 * - autoReduce === false：永远不降级
 * - reduceMode === "always"：始终降级
 * - reduceMode === "never"：从不降级
 * - reduceMode === "auto"：跟随系统 isPowerSave
 * 在以上基础上叠加 reduceItems.reduceTransparentWindow 勾选判定
 */
const shouldSuppress = (isPowerSave: boolean): boolean => {
  const cfg = readPowerSaveSettings();
  if (!cfg.autoReduce) return false;
  if (!cfg.reduceItems.reduceTransparentWindow) return false;
  if (cfg.reduceMode === "always") return true;
  if (cfg.reduceMode === "never") return false;
  return isPowerSave;
};

/**
 * 同步透明窗口降级状态
 *
 * 由电源状态变化监听器调用：拿到最新 isPowerSave 后判断是否需要切换降级状态
 *
 * @param isPowerSave 系统当前是否处于省电模式
 */
export const syncTransparentWindowSuppression = (isPowerSave: boolean): void => {
  const next = shouldSuppress(isPowerSave);
  if (next === suppressed) return;
  suppressed = next;
  if (next) {
    systemLog.info("[powerSave] 透明窗口降级已启用，关闭歌词相关窗口");
    closeDesktopLyricWindow();
    closeDynamicIslandWindow();
    if (isWin) closeTaskbarLyricWindow();
  } else {
    systemLog.info("[powerSave] 透明窗口降级已关闭，按持久化状态恢复歌词窗口");
    restoreLyricWindows();
  }
};

/**
 * 强制重新评估降级状态
 *
 * 用户修改 powerSave 设置后调用：从 powerState 缓存读取最新 isPowerSave
 * 再走 sync 路径。读取缓存失败（冷启动未轮询过）时保守视为非省电模式。
 */
export const reapplyTransparentWindowSuppression = async (): Promise<void> => {
  try {
    const snapshot = await getCachedPowerState();
    syncTransparentWindowSuppression(snapshot.isPowerSave);
  } catch (err) {
    systemLog.warn("[powerSave] 读取电源状态失败，跳过透明窗口降级重评估:", err);
  }
};

/**
 * 查询当前是否处于降级状态
 *
 * 供 desktopLyric / dynamicIsland / taskbarLyric 模块在创建窗口前判断：
 * 若处于降级状态，createXxxWindow 应直接返回 null 不创建窗口
 */
export const isTransparentWindowSuppressed = (): boolean => suppressed;
