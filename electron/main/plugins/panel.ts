/**
 * 插件 panel 类型独立窗口
 *
 * 为声明了 panel 入口的插件打开独立 BrowserWindow，让插件能展示完整 UI（而不仅是托盘 / 通知）。
 *
 * 集成状态：保守策略，仅新增文件不接入主流程。
 * 当前 PLUGIN_TYPES 仅含 source / control；panel 类型作为可选扩展，由渲染端按需调用 openPanel。
 * 未来若把 "panel" 加入 PLUGIN_TYPES，可在 loader.ts 解析头注释 @type 时一并识别。
 *
 * 关键设计：
 * - 每个 panel 插件对应一个独立 BrowserWindow，使用独立 session 分区隔离 cookie / cache
 * - 窗口 URL 来自 PanelWindowSpec.url（https:// / http:// / file://），主进程只做协议白名单
 * - 同一插件同时只允许一个 panel 窗口；再次调用 openPanel 会聚焦已有窗口
 * - 插件卸载 / 应用退出时由 closePanel / closeAllPanels 强制清理
 */

import { BrowserWindow, session, shell, type BrowserWindowConstructorOptions } from "electron";
import { pluginLog } from "@main/utils/logger";
import { pluginRegistry } from "./registry";

/** panel 窗口默认尺寸 */
const PANEL_DEFAULT_WIDTH = 480;
const PANEL_DEFAULT_HEIGHT = 720;
const PANEL_MIN_WIDTH = 320;
const PANEL_MIN_HEIGHT = 240;

/** panel 窗口 session 分区前缀；按 pluginId 隔离 cookie / cache / localStorage */
const PANEL_PARTITION_PREFIX = "persist:plugin-panel-";

/** 打开 panel 窗口的描述符 */
export interface PanelWindowSpec {
  /** 插件 id（必须已注册到 pluginRegistry） */
  pluginId: string;
  /** panel 标题（显示在窗口标题栏） */
  title: string;
  /** panel 入口 URL（https:// / http:// / file://） */
  url: string;
  /** 初始宽度；缺省 480 */
  width?: number;
  /** 初始高度；缺省 720 */
  height?: number;
  /** 是否置顶；缺省 false */
  alwaysOnTop?: boolean;
}

/** 已打开的 panel 窗口集合：pluginId → BrowserWindow */
const panelWindows = new Map<string, BrowserWindow>();

/** 取或创建 panel 专属 session（按 pluginId 隔离 cookie / cache） */
const getPanelSession = (pluginId: string): Electron.Session => {
  const partition = `${PANEL_PARTITION_PREFIX}${pluginId}`;
  return session.fromPartition(partition);
};

/** 校验 URL 协议是否允许 panel 加载（防 file:// 之外的自定义协议越权） */
const isAllowedPanelUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "file:"
    );
  } catch {
    return false;
  }
};

/** 构造 panel 窗口的默认配置 */
const buildPanelWindowOptions = (spec: PanelWindowSpec): BrowserWindowConstructorOptions => ({
  width: spec.width ?? PANEL_DEFAULT_WIDTH,
  height: spec.height ?? PANEL_DEFAULT_HEIGHT,
  minWidth: PANEL_MIN_WIDTH,
  minHeight: PANEL_MIN_HEIGHT,
  title: spec.title || "Plugin Panel",
  autoHideMenuBar: true,
  backgroundColor: "#1a1a1a",
  show: false,
  alwaysOnTop: spec.alwaysOnTop ?? false,
  webPreferences: {
    session: getPanelSession(spec.pluginId),
    sandbox: true,
    spellcheck: false,
    // panel 内容可能是动态刷新的可视化面板，隐藏时也保持流畅
    backgroundThrottling: false,
    nodeIntegration: false,
    contextIsolation: true,
  },
});

/**
 * 打开（或聚焦）某插件的 panel 窗口
 *
 * 同一插件只能开一个 panel 窗口；已存在则聚焦，不再新建。
 * URL 协议非法 / 插件未注册时抛错，调用方据此向用户提示。
 * @param spec - panel 描述符
 * @returns 已存在或新建的 BrowserWindow
 */
export const openPanel = (spec: PanelWindowSpec): BrowserWindow => {
  const existing = panelWindows.get(spec.pluginId);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return existing;
  }
  if (!isAllowedPanelUrl(spec.url)) {
    throw new Error(`panel url not allowed: ${spec.url}`);
  }
  const rt = pluginRegistry.getRuntime(spec.pluginId);
  if (!rt) {
    throw new Error(`plugin ${spec.pluginId} not found`);
  }

  const win = new BrowserWindow(buildPanelWindowOptions(spec));
  panelWindows.set(spec.pluginId, win);

  win.once("ready-to-show", () => win.show());

  win.on("closed", () => {
    panelWindows.delete(spec.pluginId);
    pluginLog.info(`[panel] ${spec.pluginId} closed`);
  });

  // 阻止新窗口弹出，保持单窗口 panel 体验
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target && target !== "about:blank") {
      void shell.openExternal(target);
    }
    return { action: "deny" };
  });

  // 主框架外链跳转交给系统浏览器，避免 panel 内导航走丢
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== spec.url && !url.startsWith("about:")) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  void win.loadURL(spec.url).catch((err) => {
    pluginLog.error(`[panel] ${spec.pluginId} loadURL failed:`, err);
  });

  pluginLog.info(`[panel] ${spec.pluginId} opened url=${spec.url}`);
  return win;
};

/** 关闭某插件的 panel 窗口（不存在则忽略） */
export const closePanel = (pluginId: string): void => {
  const win = panelWindows.get(pluginId);
  if (!win || win.isDestroyed()) {
    panelWindows.delete(pluginId);
    return;
  }
  try {
    win.destroy();
  } catch {
    /* ignore */
  }
  panelWindows.delete(pluginId);
};

/** 关闭所有 panel 窗口（应用退出 / 插件批量卸载时调用） */
export const closeAllPanels = (): void => {
  for (const [, win] of panelWindows) {
    if (!win.isDestroyed()) {
      try {
        win.destroy();
      } catch {
        /* ignore */
      }
    }
  }
  panelWindows.clear();
};

/** 查询某插件 panel 是否处于打开状态 */
export const isPanelOpen = (pluginId: string): boolean => {
  const win = panelWindows.get(pluginId);
  return !!win && !win.isDestroyed();
};

/** 列出当前已打开 panel 的插件 id（用于渲染端同步 UI 状态） */
export const listOpenPanels = (): string[] => Array.from(panelWindows.keys());
