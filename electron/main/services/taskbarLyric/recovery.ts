/**
 * 任务栏歌词 Windows 重启恢复
 *
 * Windows 重启或 explorer.exe 崩溃后，任务栏歌词窗口会丢失。
 * 本模块负责：
 * 1. 持久化启用状态到磁盘
 * 2. 启动时检测是否需要恢复（24 小时窗口）
 * 3. 提供状态校验
 */

/** 恢复状态文件版本 */
const RECOVERY_STATE_VERSION = 1;

/** 恢复窗口期：24 小时 */
const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface TaskbarLyricRecoveryState {
  /** 任务栏歌词是否启用 */
  enabled: boolean;
  /** 当前播放曲目 ID（用于恢复后继续显示） */
  trackId: string;
  /** 播放位置（毫秒） */
  positionMs: number;
  /** 状态写入时间戳 */
  timestamp: number;
  /** 状态文件版本 */
  version: number;
}

/** 构建恢复状态对象 */
export const buildRecoveryState = (input: {
  enabled: boolean;
  trackId: string;
  positionMs: number;
  timestamp?: number;
}): TaskbarLyricRecoveryState => ({
  enabled: input.enabled,
  trackId: input.trackId,
  positionMs: input.positionMs,
  timestamp: input.timestamp ?? Date.now(),
  version: RECOVERY_STATE_VERSION,
});

/** 判断启动时是否需要恢复任务栏歌词 */
export const shouldRecoverOnStartup = (
  state: TaskbarLyricRecoveryState,
  now: number = Date.now(),
): boolean => {
  if (!state.enabled) return false;
  if (now - state.timestamp > RECOVERY_WINDOW_MS) return false;
  if (!state.trackId) return false;
  return true;
};

/** 校验恢复状态对象是否合法 */
export const isRecoveryStateValid = (state: unknown): state is TaskbarLyricRecoveryState => {
  if (!state || typeof state !== "object") return false;
  const s = state as Record<string, unknown>;
  if (s.version !== RECOVERY_STATE_VERSION) return false;
  if (typeof s.enabled !== "boolean") return false;
  if (typeof s.trackId !== "string") return false;
  if (typeof s.positionMs !== "number") return false;
  if (typeof s.timestamp !== "number") return false;
  return true;
};

/** 恢复状态文件路径（相对用户数据目录） */
export const RECOVERY_STATE_FILENAME = "taskbar-lyric-recovery.json";

/** 读取恢复状态文件，不存在或无效返回 null */
export const readRecoveryState = async (
  userDataDir: string,
): Promise<TaskbarLyricRecoveryState | null> => {
  const { join } = await import("node:path");
  const { default: fs } = await import("node:fs");
  const filePath = join(userDataDir, RECOVERY_STATE_FILENAME);
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    if (!isRecoveryStateValid(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
};

/** 写入恢复状态文件 */
export const writeRecoveryState = async (
  userDataDir: string,
  state: TaskbarLyricRecoveryState,
): Promise<void> => {
  const { join } = await import("node:path");
  const { default: fs } = await import("node:fs");
  const filePath = join(userDataDir, RECOVERY_STATE_FILENAME);
  await fs.promises.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
};

/** 清除恢复状态文件 */
export const clearRecoveryState = async (userDataDir: string): Promise<void> => {
  const { join } = await import("node:path");
  const { default: fs } = await import("node:fs");
  const filePath = join(userDataDir, RECOVERY_STATE_FILENAME);
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // 文件不存在视为已清除
  }
};
