/**
 * 播放界面布局插件接口
 *
 * 第三方插件通过此接口注册自定义播放界面布局。
 *
 * 使用示例（在 renderer-side 扩展 / 内置插件加载流程中）：
 * ```ts
 * import { playerLayouts } from "@/player/layouts/pluginApi";
 * import MyLayout from "./MyLayout.vue";
 *
 * const dispose = playerLayouts.register({
 *   id: "my-plugin.custom-layout",
 *   name: "我的自定义布局",
 *   description: "封面与歌词上下分栏",
 *   component: MyLayout,
 *   pluginId: "user.myplugin",
 * });
 *
 * // 卸载插件时调用 dispose() 自动注销
 * ```
 *
 * 注意：本接口仅适用于可访问 Vue 运行时的 renderer-side 代码。
 * 沙箱化的 JS 插件（在 worker 中运行）无法直接注册 Vue 组件——
 * 这类插件若需扩展播放界面，应通过 metadata 声明意图，
 * 由 renderer-side 的桥接代码加载对应的 Vue 组件后再调用本接口。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import type { PlayerLayout } from "./registry";
import {
  registerPlayerLayout,
  unregisterPlayerLayout,
  unregisterPlayerLayoutsByPlugin,
  getPlayerLayouts,
  getPlayerLayout,
  onPlayerLayoutsChange,
  getPlayerLayoutsVersion,
} from "./registry";

/**
 * 播放界面布局注册表插件接口
 *
 * 暴露给第三方插件的稳定 API 表面：
 * - register：注册一个布局，返回 Disposable
 * - unregister：按 id 注销单个布局
 * - unregisterByPlugin：批量注销某插件的所有布局（用于插件卸载）
 * - list：列出所有已注册布局
 * - get：按 id 获取单个布局
 * - onChange：订阅布局列表变化
 * - version：获取当前注册表版本号
 */
export interface PlayerLayoutPluginApi {
  /** 注册一个播放界面布局；同 id 已注册时抛错 */
  register: (layout: PlayerLayout) => Disposable;
  /** 注销指定 ID 的布局 */
  unregister: (id: string) => void;
  /** 批量注销某插件注册的所有布局（用于插件热更改/卸载） */
  unregisterByPlugin: (pluginId: string) => void;
  /** 获取所有已注册布局（按注册顺序） */
  list: () => PlayerLayout[];
  /** 按 ID 获取单个布局 */
  get: (id: string) => PlayerLayout | undefined;
  /** 订阅布局列表变化；返回取消订阅函数 */
  onChange: (listener: () => void) => Disposable;
  /** 获取当前注册表版本号（每次变更递增） */
  version: () => number;
}

/**
 * 播放界面布局注册表插件接口单例
 *
 * 暴露 register/unregister/list/get/onChange/version 六个方法给第三方插件。
 * 内部直接转发到 src/player/layouts/registry.ts 的实现。
 */
export const playerLayouts: PlayerLayoutPluginApi = {
  register: registerPlayerLayout,
  unregister: unregisterPlayerLayout,
  unregisterByPlugin: unregisterPlayerLayoutsByPlugin,
  list: getPlayerLayouts,
  get: getPlayerLayout,
  onChange: onPlayerLayoutsChange,
  version: getPlayerLayoutsVersion,
};

export type { PlayerLayout, Disposable };
