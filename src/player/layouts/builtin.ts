/**
 * 内置播放界面布局注册
 *
 * 在应用启动时调用 registerBuiltinPlayerLayouts()，把 3 个内置布局注册到
 * PlayerLayoutRegistry。重复调用安全（已注册的 id 会跳过）。
 *
 * pluginId 统一为 "soto.builtin"，第三方插件用同 id 注册时会抛错——
 * 第三方插件应使用自己的 pluginId（如 "user.myplugin"）以避免冲突。
 */
import type { Disposable } from "../../../shared/extensions/disposable";
import { defineAsyncComponent } from "vue";
import { registerPlayerLayout, getPlayerLayout } from "./registry";

// 异步导入布局组件，避免歌词引擎/频谱/粒子等重组件进入主入口 chunk，
// 首屏（Home 页）无需等待这些模块转换与求值。
const ClassicLayout = defineAsyncComponent(() => import("./ClassicLayout.vue"));
const FullscreenLyricsLayout = defineAsyncComponent(() => import("./FullscreenLyricsLayout.vue"));
const CenteredAlbumLayout = defineAsyncComponent(() => import("./CenteredAlbumLayout.vue"));

/** 内置布局的统一 pluginId */
export const BUILTIN_PLAYER_LAYOUT_PLUGIN_ID = "soto.builtin";

/**
 * 注册 3 个内置播放界面布局
 *
 * - classic：经典左右分栏（封面 + 歌词），保留原 FullPlayer 全部行为
 * - fullscreen-lyrics：全屏歌词布局，封面缩小到右上角
 * - centered-album：居中专辑布局，封面居中，歌词下方
 *
 * @returns Disposable，dispose 时撤销全部注册
 */
export const registerBuiltinPlayerLayouts = (): Disposable => {
  const disposables: Disposable[] = [];

  // 经典布局
  if (!getPlayerLayout("classic")) {
    disposables.push(
      registerPlayerLayout({
        id: "classic",
        name: "settings.playerLayout.classic.label",
        description: "settings.playerLayout.classic.description",
        component: ClassicLayout,
        pluginId: BUILTIN_PLAYER_LAYOUT_PLUGIN_ID,
      }),
    );
  }

  // 全屏歌词布局
  if (!getPlayerLayout("fullscreen-lyrics")) {
    disposables.push(
      registerPlayerLayout({
        id: "fullscreen-lyrics",
        name: "settings.playerLayout.fullscreenLyrics.label",
        description: "settings.playerLayout.fullscreenLyrics.description",
        component: FullscreenLyricsLayout,
        pluginId: BUILTIN_PLAYER_LAYOUT_PLUGIN_ID,
      }),
    );
  }

  // 居中专辑布局
  if (!getPlayerLayout("centered-album")) {
    disposables.push(
      registerPlayerLayout({
        id: "centered-album",
        name: "settings.playerLayout.centeredAlbum.label",
        description: "settings.playerLayout.centeredAlbum.description",
        component: CenteredAlbumLayout,
        pluginId: BUILTIN_PLAYER_LAYOUT_PLUGIN_ID,
      }),
    );
  }

  return {
    dispose: () => {
      for (const d of disposables) d.dispose();
    },
  };
};
