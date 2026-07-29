/**
 * 视频渲染离屏窗口
 *
 * 单例窗口，仅在渲染任务执行期间存活。
 * - show: false（不显示给用户，离屏渲染）
 * - backgroundThrottling: false（RAF 不能被节流）
 * - webgl: true（FluidBackground 等特效依赖 WebGL/Canvas2D 加速）
 * - 不可调整大小、不可最大化、不出现在任务栏
 *
 * 使用独立 partition（persist:video-renderer）：
 * - 隔离 onHeadersReceived CORS 注入，避免污染主窗口 session
 * - 避免干扰 dev server HMR WebSocket 握手
 */

import { BrowserWindow } from "electron";
import { join } from "path";
import { isDev } from "@main/utils/config";
import { renderVideoLog } from "@main/utils/logger";
import { handleCacheProtocolOnPartition } from "@main/utils/protocol";
import { createWindow } from "./create";

/** 渲染窗口单例 */
let videoRendererWindow: BrowserWindow | null = null;

/** 默认尺寸（实际尺寸由渲染分辨率决定，窗口尺寸需大于等于分辨率） */
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

/** 渲染窗口专用 session partition（隔离 CORS 钩子） */
const RENDERER_PARTITION = "persist:video-renderer";

/**
 * 创建视频渲染离屏窗口
 * @returns BrowserWindow 实例
 */
export const createVideoRendererWindow = (): BrowserWindow => {
  // 已存在且未销毁：直接复用
  if (videoRendererWindow && !videoRendererWindow.isDestroyed()) {
    renderVideoLog.debug("[ERR-70001-A] 复用已存在的渲染窗口");
    return videoRendererWindow;
  }

  renderVideoLog.info("[ERR-70001-B] 创建渲染窗口开始");

  // 注册 cache:// 协议到渲染窗口 partition
  // 本地歌曲 track.cover 是 cache://covers/xxx.jpg URL，独立 partition 默认无此协议 handler，
  // 不注册会导致 SImg 加载失败回落到 fallback 占位图，封面"消失"
  handleCacheProtocolOnPartition(RENDERER_PARTITION);

  videoRendererWindow = createWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: 1280,
    minHeight: 720,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: "#000000",
    title: "Soto Player-Community - Video Renderer",
    webPreferences: {
      // 独立 session：隔离 CORS 钩子，避免污染主窗口
      partition: RENDERER_PARTITION,
      // 渲染窗口需要 WebGL 加速
      webgl: true,
      // RAF 不能被后台节流（视频帧必须按时生成）
      backgroundThrottling: false,
      // 关闭拼写检查减少开销
      spellcheck: false,
      // 关闭 Web SQL
      enableWebSQL: false,
      // 不需要节点集成
      nodeIntegration: false,
      contextIsolation: true,
      // 允许加载跨域音频（网易云等无 CORS 头的场景）
      webSecurity: false,
      // 允许混合内容（https 页面加载 http 音频）
      allowRunningInsecureContent: true,
    },
  });

  // 仅对 http/https 外部音频 URL 注入 CORS 头
  // 排除 dev server (localhost) 和 file:// 协议，避免干扰 HMR 和本地资源
  videoRendererWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ["https://*/*", "http://*/*"] },
    (details, callback) => {
      // 跳过 dev server 和 localhost
      const url = details.url;
      if (url.includes("://localhost") || url.includes("://127.0.0.1")) {
        callback({});
        return;
      }
      const headers = { ...details.responseHeaders };
      // 移除限制跨域的头
      delete headers["access-control-allow-origin"];
      delete headers["Access-Control-Allow-Origin"];
      // 注入允许跨域的头
      headers["access-control-allow-origin"] = ["*"];
      callback({ responseHeaders: headers });
    },
  );

  // 加载渲染窗口入口
  if (isDev && process.env["ELECTRON_RENDERER_URL"]) {
    const url = `${process.env["ELECTRON_RENDERER_URL"]}/windows/video-renderer/index.html`;
    renderVideoLog.info(`[ERR-70001-C] dev 模式加载 URL: ${url}`);
    void videoRendererWindow.loadURL(url);
  } else {
    const file = join(__dirname, "../renderer/windows/video-renderer/index.html");
    renderVideoLog.info(`[ERR-70001-D] 生产模式加载文件: ${file}`);
    void videoRendererWindow.loadFile(file);
  }

  // 加载失败诊断：监听各类加载事件
  videoRendererWindow.webContents.on("did-fail-load", (_e, errorCode, errorDescription, validatedURL) => {
    renderVideoLog.error(
      `[ERR-70002-A] 渲染窗口加载失败 code=${errorCode} desc=${errorDescription} url=${validatedURL}`,
    );
  });
  videoRendererWindow.webContents.on("render-process-gone", (_e, details) => {
    renderVideoLog.error(
      `[ERR-70002-B] 渲染进程崩溃 reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
  videoRendererWindow.webContents.on("unresponsive", () => {
    renderVideoLog.error("[ERR-70002-C] 渲染进程无响应");
  });
  videoRendererWindow.webContents.on("console-message", (_e, level, message, line, sourceId) => {
  const tag = ["LOG", "WARN", "ERROR", "DEBUG", "INFO", "ALL"][level] ?? "LOG";
  // 提升到 info 级，避免生产环境 file transport（info 阈值）过滤掉渲染窗口诊断日志
  // ERROR/WARN 用 warn 级，INFO/LOG/DEBUG 用 info 级
  if (tag === "ERROR" || tag === "WARN") {
    renderVideoLog.warn(`[renderer-console][${tag}] ${message} (${sourceId}:${line})`);
  } else {
    renderVideoLog.info(`[renderer-console][${tag}] ${message} (${sourceId}:${line})`);
  }
});

  // 窗口关闭：清理单例引用 + 通知 manager 重置 ready 标志
  videoRendererWindow.on("closed", () => {
    renderVideoLog.info("[ERR-70001-E] 渲染窗口已关闭");
    videoRendererWindow = null;
    // 通知 manager 重置 ready 标志，下次创建窗口时重新等待
    import("@main/services/renderVideoManager")
      .then((m) => m.resetReady())
      .catch((err) => {
        renderVideoLog.error(`[ERR-70001-F] 重置 ready 标志失败: ${String(err)}`);
      });
  });

  renderVideoLog.info("[ERR-70001-G] 创建渲染窗口完成");
  return videoRendererWindow;
};

/**
 * 获取当前渲染窗口（可能为 null）
 */
export const getVideoRendererWindow = (): BrowserWindow | null => {
  if (videoRendererWindow && !videoRendererWindow.isDestroyed()) {
    return videoRendererWindow;
  }
  return null;
};

/**
 * 关闭渲染窗口（在任务完成或取消后调用）
 */
export const closeVideoRendererWindow = (): void => {
  if (videoRendererWindow && !videoRendererWindow.isDestroyed()) {
    renderVideoLog.info("[ERR-70001-H] 主动关闭渲染窗口");
    videoRendererWindow.close();
  }
  videoRendererWindow = null;
};

/**
 * 向渲染窗口发送消息
 * @param channel IPC 通道
 * @param data 数据
 */
export const sendToRenderer = (channel: string, data: unknown): void => {
  const win = getVideoRendererWindow();
  if (win) {
    win.webContents.send(channel, data);
  } else {
    renderVideoLog.warn(`[ERR-70010-A] 发送 ${channel} 失败：渲染窗口不存在`);
  }
};
