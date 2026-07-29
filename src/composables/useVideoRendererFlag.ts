/**
 * 视频渲染窗口环境标志
 *
 * 渲染窗口启动时通过 setVideoRendererFlag(true) 启用，
 * 用于让共享组件（如 PlayerCover）在不影响主窗口逻辑的前提下跳过渲染窗口不适用
 * 的副作用（如依赖主进程 audio-engine 当前 track 的 IPC 调用）。
 *
 * 默认 false，主窗口及未设置环境下走原有逻辑。
 */

let isVideoRendererFlag = false;

export const setVideoRendererFlag = (enabled: boolean): void => {
  isVideoRendererFlag = enabled;
};

export const isVideoRenderer = (): boolean => isVideoRendererFlag;
