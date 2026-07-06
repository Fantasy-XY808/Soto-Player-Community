import { powerSaveBlocker } from "electron";
import { systemLog } from "@main/utils/logger";

/**
 * 防休眠服务：仅在「播放中 + 设置开启」时阻塞系统休眠 / 屏幕熄灭
 *
 * 用 Electron 的 powerSaveBlocker 实现：
 * - "prevent-display-sleep" 阻止屏幕熄灭（同时也阻止系统休眠）
 * - 暂停 / 停止 / 关闭设置时立即释放
 *
 * 设计要点：
 * - 单例 blocker id，重复 start 会先 stop 旧的再 start 新的
 * - 配置变更时由 IPC config 派发；播放状态变更时由 player stateChanged 派发
 * - 任何一方变为 false 都立即释放，避免长时暂停仍占用防休眠
 */

let blockerId: number | null = null;

/** 阻止系统休眠（如已在阻止则保持） */
const startBlock = (): void => {
  if (blockerId !== null) return;
  blockerId = powerSaveBlocker.start("prevent-display-sleep");
  systemLog.info(`已启用防休眠 (blocker=${blockerId})`);
};

/** 释放防休眠（如未启用则空操作） */
const stopBlock = (): void => {
  if (blockerId === null) return;
  powerSaveBlocker.stop(blockerId);
  systemLog.info(`已关闭防休眠 (blocker=${blockerId})`);
  blockerId = null;
};

/**
 * 按当前「播放状态 + 设置开关」同步防休眠
 *
 * 调用时机：
 * 1. 播放器 stateChanged（player.ts）
 * 2. system.preventSleep 配置变更（config.ts）
 *
 * @param playing - 当前是否正在播放
 * @param enabled - 设置中是否启用防休眠
 */
export const syncPreventSleep = (playing: boolean, enabled: boolean): void => {
  if (playing && enabled) {
    startBlock();
  } else {
    stopBlock();
  }
};

/** 应用退出时清理防休眠，避免泄漏 blocker */
export const cleanupPreventSleep = (): void => {
  stopBlock();
};
