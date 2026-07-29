/**
 * 视频播放状态 IPC
 *
 * 主窗口 → video:set-playback-state → 广播到 taskbar-lyric / desktop-lyric / dynamic-island
 * 多窗口 → video:get-playback-state → 拉取当前缓存的视频状态（新窗口 ready-to-show 后调用，避免错过首次状态）
 */

import { ipcMain } from "electron";
import {
  broadcastVideoPlaybackState,
  getVideoPlaybackState,
} from "@main/services/videoPlayback";
import type { VideoPlaybackStateEvent } from "@shared/types/video";

export const registerVideoIpc = (): void => {
  // 渲染进程（主窗口的 MvDetail.vue / Video.vue）通知主进程广播视频播放状态
  ipcMain.handle(
    "video:set-playback-state",
    async (_event, event: VideoPlaybackStateEvent): Promise<void> => {
      broadcastVideoPlaybackState(event);
    },
  );

  // 多窗口拉取当前缓存的视频播放状态（用于新窗口订阅后主动同步）
  ipcMain.handle("video:get-playback-state", (): VideoPlaybackStateEvent => {
    return getVideoPlaybackState();
  });
};
