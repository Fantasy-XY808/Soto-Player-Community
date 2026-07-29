import { ipcMain } from "electron";
import {
  openRgbService,
  OPENRGB_STATUS_CHANGE_EVENT,
} from "@main/services/openrgb";
import { broadcast } from "@main/utils/broadcast";
import type {
  RgbColor,
  RgbFrameData,
  RgbSyncStatus,
} from "@shared/types/rgbSync";

/** 渲染端订阅状态变化的通道名 */
const OPENRGB_STATUS_CHANGE_CHANNEL = "openrgb:statusChange";

/** 类型守卫：判断值是否为合法 RgbColor */
const isRgbColor = (value: unknown): value is RgbColor => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.r === "number" &&
    typeof v.g === "number" &&
    typeof v.b === "number"
  );
};

/** 类型守卫：判断值是否为合法 RgbFrameData */
const isRgbFrameData = (value: unknown): value is RgbFrameData => {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (typeof v.deviceId !== "number") return false;
  if (!Array.isArray(v.colors)) return false;
  return v.colors.every(isRgbColor);
};

/** 注册 OpenRGB 相关 IPC */
export const registerOpenRgbIpc = (): void => {
  // 查询当前状态
  ipcMain.handle("openrgb:getStatus", (): RgbSyncStatus => openRgbService.getStatus());

  // 连接 OpenRGB 服务
  ipcMain.handle(
    "openrgb:connect",
    (_event, host: string, port: number): Promise<RgbSyncStatus> => {
      if (typeof host !== "string" || typeof port !== "number") {
        return Promise.resolve({
          ...openRgbService.getStatus(),
          error: "参数错误：host/port 缺失",
        });
      }
      return openRgbService.connect(host, port);
    },
  );

  // 断开连接
  ipcMain.handle("openrgb:disconnect", (): void => {
    openRgbService.disconnect();
  });

  // 刷新设备列表
  ipcMain.handle("openrgb:refreshDevices", () => openRgbService.refreshDevices());

  // 渲染端推送一帧颜色到多个设备
  ipcMain.handle("openrgb:setColors", (_event, frames: unknown): void => {
    if (!Array.isArray(frames)) return;
    const valid = frames.filter(isRgbFrameData);
    openRgbService.setColors(valid);
  });

  // 测试单个设备颜色
  ipcMain.handle(
    "openrgb:testColor",
    async (_event, deviceId: unknown, color: unknown): Promise<void> => {
      if (typeof deviceId !== "number") {
        throw new Error("参数错误：deviceId 必须为 number");
      }
      if (!isRgbColor(color)) {
        throw new Error("参数错误：color 必须为 { r, g, b }");
      }
      await openRgbService.testColor(deviceId, color);
    },
  );

  // 订阅状态变化：service → 广播到所有窗口
  openRgbService.on(OPENRGB_STATUS_CHANGE_EVENT, (status: RgbSyncStatus) => {
    broadcast(OPENRGB_STATUS_CHANGE_CHANNEL, status);
  });
};
