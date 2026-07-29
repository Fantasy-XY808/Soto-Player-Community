/**
 * ChmlFrp 控制台窗口
 *
 * 打开独立 BrowserWindow 加载 ChmlFrp 控制台（panel.chmlfrp.net），让用户在应用内完成
 * 注册账号 → 创建隧道 → 下载 frpc.toml 全流程，不跳转外部浏览器。
 *
 * 复用 login.ts 的模板：
 * - 独立 session 分区（persist:chmlfrp-console）隔离 cookie
 * - 伪装 UA 避免被识别为 Electron
 * - 阻止新窗口
 *
 * 额外能力：
 * - 监听 will-download 事件，捕获 frpc.toml 文件下载并自动读取内容回填到 HostDialog
 * - 同时监听 navigation，当用户从 frpc.toml 下载链接导航离开时，尝试 fetch toml 内容
 */

import { BrowserWindow, session } from "electron";
import { getMainWindow } from "./main";
import { coreLog } from "@main/utils/logger";
import { readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const CHMLFRP_PARTITION = "persist:chmlfrp-console";
const CHMLFRP_URL = "https://panel.chmlfrp.net";

/**
 * 伪装成普通桌面 Chrome
 * 默认 UA 含 "Electron/..."，部分站点会判定为不受支持环境
 */
const FAKE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

let activeWin: BrowserWindow | null = null;

/**
 * 打开 ChmlFrp 控制台窗口
 *
 * 用户在窗口内完成注册/登录/创建隧道/下载 frpc.toml 全流程。
 * 监听 will-download 事件捕获 toml 文件，读取内容后返回。
 *
 * @returns 成功返回 frpc.toml 内容；用户关闭窗口或下载失败返回 null
 */
export const openChmlFrpConsoleWindow = async (): Promise<string | null> => {
  // 已存在则先聚焦
  if (activeWin && !activeWin.isDestroyed()) {
    activeWin.focus();
    return null;
  }

  // 清掉旧的会话（可选：保留登录态便于下次直接下载新隧道）
  // 此处保留 cookie，避免用户每次都要重新登录
  const ses = session.fromPartition(CHMLFRP_PARTITION);
  ses.setUserAgent(FAKE_UA);

  const parent = getMainWindow() ?? undefined;

  activeWin = new BrowserWindow({
    parent,
    modal: false,
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    center: true,
    title: "ChmlFrp 控制台 - 一起听跨网穿透",
    autoHideMenuBar: true,
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: {
      session: ses,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  activeWin.webContents.setUserAgent(FAKE_UA);

  // 阻止新窗口：用户点击外链时在当前窗口内导航，不弹出外部浏览器
  activeWin.webContents.setWindowOpenHandler((details) => {
    activeWin?.webContents.loadURL(details.url).catch(() => {
      /* 忽略导航失败 */
    });
    return { action: "deny" };
  });

  return await new Promise<string | null>((resolve) => {
    let settled = false;
    let downloadCaptured = false;

    const finish = (result: string | null): void => {
      if (settled) return;
      settled = true;
      if (activeWin && !activeWin.isDestroyed()) {
        // 下载捕获后给用户 1.5s 看到成功提示再关窗
        setTimeout(() => {
          if (activeWin && !activeWin.isDestroyed()) {
            activeWin.destroy();
          }
        }, 1500);
      }
      activeWin = null;
      resolve(result);
    };

    activeWin!.once("ready-to-show", () => activeWin?.show());

    // 监听下载：捕获 frpc.toml 文件
    ses.on("will-download", async (_event, item) => {
      const filename = item.getFilename();
      coreLog.info(`[chmlfrp] 检测到下载: ${filename}`);

      // 只接受 toml 文件，其他下载走默认保存流程
      if (!filename.toLowerCase().endsWith(".toml")) {
        coreLog.info(`[chmlfrp] 非 toml 文件，走默认下载流程`);
        return;
      }

      // 重定向到临时目录，避免污染用户下载文件夹
      const savePath = join(tmpdir(), `soto-frpc-${Date.now()}.toml`);
      item.setSavePath(savePath);

      item.once("done", async (_e, state) => {
        if (downloadCaptured) return;
        if (state !== "completed") {
          coreLog.warn(`[chmlfrp] 下载未完成，state=${state}`);
          finish(null);
          return;
        }
        downloadCaptured = true;
        try {
          const content = await readFile(savePath, "utf-8");
          coreLog.info(`[chmlfrp] toml 读取成功，长度=${content.length}`);
          finish(content);
        } catch (err) {
          coreLog.error(`[chmlfrp] toml 读取失败:`, err);
          finish(null);
        }
      });
    });

    // 监听导航：如果用户导航到 .toml 直链（部分面板支持点击下载按钮直接跳转 toml URL），
    // 尝试用 session 的 cookie fetch 该 URL 获取内容
    activeWin!.webContents.on("will-redirect", async (event, url) => {
      if (!url.toLowerCase().endsWith(".toml") && !url.includes("frpc.toml")) return;
      event.preventDefault();
      try {
        const resp = await ses.fetch(url);
        if (resp.ok) {
          const text = await resp.text();
          if (text && text.includes("serverAddr")) {
            coreLog.info(`[chmlfrp] 通过导航拦截获取 toml 成功，长度=${text.length}`);
            finish(text);
          }
        }
      } catch (err) {
        coreLog.warn(`[chmlfrp] 导航拦截 fetch 失败:`, err);
      }
    });

    activeWin!.on("closed", () => finish(null));

    activeWin!.loadURL(CHMLFRP_URL, { userAgent: FAKE_UA }).catch((err) => {
      coreLog.error("[chmlfrp] loadURL failed:", err);
      finish(null);
    });
  });
};
