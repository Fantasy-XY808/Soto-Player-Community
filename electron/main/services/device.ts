import { getPlayer } from "./engine";
import { sendToMain } from "@main/utils/broadcast";
import { playerLog } from "@main/utils/logger";

/** 设备轮询定时器句柄，null 表示未启动 */
let pollingTimer: NodeJS.Timeout | null = null;
/** undefined = 尚未初始化，null = 无设备，string = 设备名 */
let lastDefaultDevice: string | null | undefined = undefined;

/** 待确认的设备变化（首次检测到差异时记录，二次确认一致才动作） */
let pendingDevice: string | null | undefined = undefined;
/** 二次确认的定时器，null 表示无待确认变化 */
let confirmTimer: NodeJS.Timeout | null = null;
/** 上次 reinitOutput 时间戳，0 表示从未执行过 */
let lastReinitAt = 0;

/** 设备变化去抖窗口：第一次检测到差异后等待此时长再二次确认 */
const DEVICE_CONFIRM_DELAY_MS = 500;
/** reinitOutput 冷却：蓝牙/USB 设备 profile 切换时设备名会连续抖动若干秒 */
const REINIT_COOLDOWN_MS = 10_000;

/**
 * 二次确认当前设备与 pending 一致后，触发 reinit 与广播
 * @param expected 首次检测到的待确认设备名
 */
const commitDeviceChange = (expected: string | null): void => {
  if (Date.now() - lastReinitAt < REINIT_COOLDOWN_MS) {
    playerLog.info(
      `设备变化到 ${expected}，但 reinit 冷却中（${REINIT_COOLDOWN_MS}ms），跳过本次重建`,
    );
    lastDefaultDevice = expected;
    return;
  }
  playerLog.info(`默认音频设备变化: ${lastDefaultDevice} → ${expected}`);
  lastDefaultDevice = expected;
  if (expected !== null) {
    try {
      getPlayer().reinitOutput();
      lastReinitAt = Date.now();
      playerLog.info("音频输出已重建");
    } catch (error) {
      playerLog.warn("重建音频输出失败:", error);
    }
  }
  sendToMain("player:event", {
    type: "deviceChanged",
    data: { defaultDevice: expected },
  });
};

/** 启动设备轮询，检测默认音频设备变化并自动重建输出 */
export const startDevicePolling = (): void => {
  if (pollingTimer !== null) return;

  pollingTimer = setInterval(() => {
    try {
      const current = getPlayer().getDefaultDeviceName() ?? null;

      // 首次记录，不触发动作
      if (lastDefaultDevice === undefined) {
        lastDefaultDevice = current;
        return;
      }
      if (current === lastDefaultDevice) {
        // 抖动结束但仍未确认 → 放弃
        if (confirmTimer !== null) {
          clearTimeout(confirmTimer);
          confirmTimer = null;
          pendingDevice = undefined;
        }
        return;
      }

      // 与待确认一致：等二次确认窗口到期再动作
      if (current === pendingDevice) return;

      // 新的差异：开启/重置二次确认窗口
      pendingDevice = current;
      if (confirmTimer !== null) clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        const expected = pendingDevice;
        pendingDevice = undefined;
        if (expected === undefined) return;
        // 二次确认时再读一次，避免在窗口期内又跳回旧设备
        const now = getPlayer().getDefaultDeviceName() ?? null;
        if (now !== expected) {
          playerLog.info(`设备在确认窗口内再次变化: ${expected} → ${now}，继续等待`);
          return;
        }
        commitDeviceChange(expected);
      }, DEVICE_CONFIRM_DELAY_MS);
    } catch {}
  }, 3000);
};

/** 停止设备轮询 */
export const stopDevicePolling = (): void => {
  if (pollingTimer === null) return;
  clearInterval(pollingTimer);
  pollingTimer = null;
  if (confirmTimer !== null) {
    clearTimeout(confirmTimer);
    confirmTimer = null;
  }
  pendingDevice = undefined;
  lastDefaultDevice = undefined;
};
