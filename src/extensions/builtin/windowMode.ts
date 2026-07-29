/**
 * 内置 WindowMode 扩展点注册
 *
 * 4 种窗口模式：
 * - standard：标准模式（主窗口默认显示）
 * - desktop：桌面歌词窗口
 * - taskbar：任务栏歌词窗口（仅 Windows）
 * - dynamicIsland：灵动岛窗口
 *
 * apply(windowId) 通过渲染端 `window.api.window.*` IPC 调用主进程窗口创建/显示。
 * dispose 时调用对应的 closeXxx 关闭窗口。
 *
 * 注意：本注册仅作为扩展点目录，不替代现有窗口管理逻辑。
 * 现有 windowStates/desktopLyric 等链路保留不动（双轨）。
 *
 * 类型适配：
 * - WindowModeDescriptor.mode 是 LyricsWindowMode（含 standard/desktop/taskbar/dynamicIsland 等），
 *   扩展点条目 id（ExtensionDescriptor.id）与 mode 同名以保持一一对应。
 * - apply 接收 windowId: string，目前 4 种模式都不消费 windowId（主进程只有一个对应窗口），
 *   参数保留以符合扩展点协议，便于未来支持多窗口。
 * - 测试在 Node.js 运行，`window` 未定义；apply 函数体内的 `window.api` 引用仅在调用时触发，
 *   模块加载时不触发，测试只验证注册元数据。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type { WindowModeDescriptor, LyricsWindowMode } from "../../../shared/types/plugin-extensions";
import { WindowModeRegistry } from "../../../shared/extensions/registries";
import { BUILTIN_PLUGIN_ID } from "./index";

/** 声明渲染端 window.api 形状，避免在 Node 测试环境加载 preload 类型 */
interface WindowApiLike {
  toggleDesktopLyric?: () => Promise<boolean>;
  closeDesktopLyric?: () => Promise<void>;
  toggleTaskbarLyric?: () => Promise<boolean>;
  closeTaskbarLyric?: () => Promise<void>;
  toggleDynamicIsland?: () => Promise<boolean>;
  closeDynamicIsland?: () => Promise<void>;
}
interface ApiLike {
  window?: WindowApiLike;
}
interface WindowLike {
  api?: ApiLike;
}

/** 安全获取渲染端 window.api（Node 环境下不存在返回 undefined） */
const getApi = (): WindowApiLike | undefined => {
  try {
    const w = (globalThis as { window?: WindowLike }).window;
    return w?.api?.window;
  } catch {
    return undefined;
  }
};

/** standard 模式：主窗口默认显示，apply/dispose 均为 no-op */
const applyStandard = async (_windowId: string): Promise<Disposable> => {
  return { dispose: () => {} };
};

/** desktop 模式：显示桌面歌词窗口；dispose 关闭 */
const applyDesktop = async (_windowId: string): Promise<Disposable> => {
  const api = getApi();
  try {
    await api?.toggleDesktopLyric?.();
  } catch {
    /* IPC 不可用时静默降级 */
  }
  return {
    dispose: () => {
      try {
        api?.closeDesktopLyric?.();
      } catch {
        /* 忽略关闭失败 */
      }
    },
  };
};

/** taskbar 模式：显示任务栏歌词窗口（仅 Windows）；dispose 关闭 */
const applyTaskbar = async (_windowId: string): Promise<Disposable> => {
  const api = getApi();
  try {
    await api?.toggleTaskbarLyric?.();
  } catch {
    /* IPC 不可用时静默降级 */
  }
  return {
    dispose: () => {
      try {
        api?.closeTaskbarLyric?.();
      } catch {
        /* 忽略关闭失败 */
      }
    },
  };
};

/** dynamicIsland 模式：显示灵动岛窗口；dispose 关闭 */
const applyDynamicIsland = async (_windowId: string): Promise<Disposable> => {
  const api = getApi();
  try {
    await api?.toggleDynamicIsland?.();
  } catch {
    /* IPC 不可用时静默降级 */
  }
  return {
    dispose: () => {
      try {
        api?.closeDynamicIsland?.();
      } catch {
        /* 忽略关闭失败 */
      }
    },
  };
};

/** 内置 4 个窗口模式元数据 */
interface BuiltinWindowModeMeta {
  id: string;
  mode: LyricsWindowMode;
  label: string;
  apply: (windowId: string) => Promise<Disposable>;
  windowsOnly: boolean;
}

const BUILTIN_MODES: readonly BuiltinWindowModeMeta[] = [
  { id: "standard", mode: "standard", label: "标准模式", apply: applyStandard, windowsOnly: false },
  { id: "desktop", mode: "desktop", label: "桌面歌词", apply: applyDesktop, windowsOnly: false },
  { id: "taskbar", mode: "taskbar", label: "任务栏歌词", apply: applyTaskbar, windowsOnly: true },
  {
    id: "dynamicIsland",
    mode: "dynamicIsland",
    label: "灵动岛",
    apply: applyDynamicIsland,
    windowsOnly: false,
  },
];

/**
 * 注册 4 个内置窗口模式
 *
 * 若某模式已注册（如 registerBuiltinExtensions 被重复调用），跳过该条目，
 * 返回的 Disposable 仅撤销本次实际注册的条目。
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerWindowModes = (): Disposable => {
  const disposables: Disposable[] = [];
  for (const meta of BUILTIN_MODES) {
    if (WindowModeRegistry.resolveDescriptor(meta.id)) continue;
    const descriptor: WindowModeDescriptor = {
      mode: meta.mode,
      label: meta.label,
      apply: meta.apply,
      windowsOnly: meta.windowsOnly,
    };
    disposables.push(
      WindowModeRegistry.register({
        id: meta.id,
        pluginId: BUILTIN_PLUGIN_ID,
        priority: 0,
        implementation: descriptor,
      }),
    );
  }
  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
};
