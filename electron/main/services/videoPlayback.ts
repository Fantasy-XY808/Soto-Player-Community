/**
 * 视频播放状态广播服务
 *
 * 当用户进入 MV / Video 详情页时，主窗口会暂停音乐播放，
 * 但 taskbar-lyric / desktop-lyric / dynamic-island 三个独立窗口
 * 仍显示之前的音乐歌词。本服务把"正在播放视频"状态广播到这三个窗口，
 * 让它们切换到"视频播放中"模式（隐藏音乐歌词、改显视频标题）。
 *
 * 退出 MV / Video 页时广播 isPlayingVideo=false，多窗口恢复显示音乐歌词。
 */

import { videoLog } from "@main/utils/logger";
import { getDesktopLyricWindow } from "@main/window/desktopLyric";
import { getDynamicIslandWindow } from "@main/window/dynamicIsland";
import { getTaskbarLyricWindow } from "@main/window/taskbarLyric";
import type { VideoPlaybackStateEvent } from "@shared/types/video";

/** IPC 通道名：主进程 → 多窗口广播视频播放状态 */
export const VIDEO_PLAYBACK_STATE_CHANNEL = "video:playback-state";

/** 当前视频播放状态缓存：新窗口 ready-to-show 后可主动重播，避免错过首次状态 */
let currentState: VideoPlaybackStateEvent = { isPlayingVideo: false };

/** 取当前缓存的视频播放状态（供新窗口主动拉取） */
export const getVideoPlaybackState = (): VideoPlaybackStateEvent => currentState;

/**
 * 广播视频播放状态到 taskbar-lyric / desktop-lyric / dynamic-island
 *
 * 不通过 utils/broadcast.ts 的 `BrowserWindow.getAllWindows()` 全量广播，
 * 而是定向发送给三个歌词窗口，避免给主窗口 / 登录窗口 / 视频渲染窗口下发无关事件。
 * 任一窗口未创建或已销毁时静默跳过，不影响其他窗口接收。
 */
export const broadcastVideoPlaybackState = (event: VideoPlaybackStateEvent): void => {
  currentState = event;
  const targets = [
    getTaskbarLyricWindow(),
    getDesktopLyricWindow(),
    getDynamicIslandWindow(),
  ];
  let delivered = 0;
  for (const win of targets) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.webContents.send(VIDEO_PLAYBACK_STATE_CHANNEL, event);
      delivered++;
    } catch (err) {
      videoLog.warn(`send to window failed: ${err}`);
    }
  }
  videoLog.info(
    `broadcast video state: isPlayingVideo=${event.isPlayingVideo} title=${event.title ?? "-"} source=${event.source ?? "-"} delivered=${delivered}`,
  );
};
