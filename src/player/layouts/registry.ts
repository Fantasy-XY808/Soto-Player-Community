/**
 * 播放界面布局注册表
 *
 * 设计目标：
 * - 抽象 FullPlayer 的"主区域"渲染，使其可被多种布局替换
 * - 内置若干布局（classic / fullscreen-lyrics / centered-album）
 * - 第三方插件可注册自定义布局，无需 fork 主仓库
 *
 * 使用方式：
 * ```ts
 * import { registerPlayerLayout } from "@/player/layouts/registry";
 * import MyLayout from "./MyLayout.vue";
 *
 * const dispose = registerPlayerLayout({
 *   id: "my-layout",
 *   name: "我的布局",
 *   component: MyLayout,
 * });
 * // 卸载插件时调用 dispose() 自动注销
 * ```
 *
 * 与 shared/extensions/ExtensionRegistry 的关系：
 * - 本注册表采用与 ExtensionRegistry 相同的"register/unregister/subscribe"模式
 *   但专门服务于 Vue 组件型布局（带 name/description/thumbnail 等展示元数据）
 * - 不依赖 shared 层的 ExtensionDescriptor.pluginId/priority：布局选择列表
 *   保持注册顺序即可（内置布局先注册，第三方布局后注册）
 */
import type { Component } from "vue";
import { disposable, type Disposable } from "../../../shared/extensions/disposable";

/** 播放界面布局描述符 */
export interface PlayerLayout {
  /** 布局唯一 ID（如 "classic" / "fullscreen-lyrics"） */
  id: string;
  /** 展示名（i18n key 或字面文本） */
  name: string;
  /** 描述（i18n key 或字面文本，可选） */
  description?: string;
  /** Vue 组件：作为 FullPlayer 主区域被动态渲染 */
  component: Component;
  /** 预览图 URL（可选，用于设置页缩略图） */
  thumbnail?: string;
  /** 注册方 ID（如 "soto.builtin" / "user.myplugin"），用于按插件批量注销 */
  pluginId?: string;
}

type Listener = () => void;

const layouts = new Map<string, PlayerLayout>();
const pluginIndex = new Map<string, Set<string>>();
const listeners = new Set<Listener>();
let version = 0;

const bump = (): void => {
  version++;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* 单个监听器异常不影响其他 */
    }
  }
};

/**
 * 注册一个播放界面布局
 *
 * @returns Disposable，调用 dispose() 后自动注销该布局
 * @throws 同 ID 已注册时抛出错误
 */
export const registerPlayerLayout = (layout: PlayerLayout): Disposable => {
  if (layouts.has(layout.id)) {
    throw new Error(`Player layout already registered: ${layout.id}`);
  }
  layouts.set(layout.id, layout);

  if (layout.pluginId) {
    let set = pluginIndex.get(layout.pluginId);
    if (!set) {
      set = new Set();
      pluginIndex.set(layout.pluginId, set);
    }
    set.add(layout.id);
  }

  bump();

  let disposed = false;
  return disposable(() => {
    if (disposed) return;
    disposed = true;
    unregisterPlayerLayout(layout.id);
  });
};

/** 注销指定 ID 的布局 */
export const unregisterPlayerLayout = (id: string): void => {
  const layout = layouts.get(id);
  if (!layout) return;
  layouts.delete(id);
  if (layout.pluginId) {
    const set = pluginIndex.get(layout.pluginId);
    if (set) {
      set.delete(id);
      if (set.size === 0) pluginIndex.delete(layout.pluginId);
    }
  }
  bump();
};

/** 批量注销某插件注册的所有布局（用于插件热更改/卸载） */
export const unregisterPlayerLayoutsByPlugin = (pluginId: string): void => {
  const set = pluginIndex.get(pluginId);
  if (!set || set.size === 0) return;
  for (const id of set) {
    layouts.delete(id);
  }
  pluginIndex.delete(pluginId);
  bump();
};

/** 获取所有已注册布局（按注册顺序） */
export const getPlayerLayouts = (): PlayerLayout[] => Array.from(layouts.values());

/** 按 ID 获取单个布局 */
export const getPlayerLayout = (id: string): PlayerLayout | undefined => layouts.get(id);

/** 获取当前注册表版本号（每次变更递增） */
export const getPlayerLayoutsVersion = (): number => version;

/**
 * 订阅布局列表变化
 *
 * @returns Disposable，调用后取消订阅
 */
export const onPlayerLayoutsChange = (listener: Listener): Disposable => {
  listeners.add(listener);
  return disposable(() => {
    listeners.delete(listener);
  });
};
