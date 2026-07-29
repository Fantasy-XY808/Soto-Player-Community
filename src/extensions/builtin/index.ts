/**
 * 内置扩展点注册入口
 *
 * 阶段 3 基础设施：提供统一的 registerBuiltinExtensions() 函数，
 * 供应用启动时调用，把内置功能注册到 12 个 ExtensionRegistry。
 *
 * pluginId 统一为 "soto.builtin"，priority 用 0（最低，让第三方插件可覆盖）。
 * 返回 CompositeDisposable，dispose 时撤销所有注册。
 *
 * 阶段 3.0 仅搭建骨架，具体扩展点注册由后续 Task 3.1-3.6 填充。
 */
import { CompositeDisposable } from "../../../shared/extensions/disposable";
import type { Disposable } from "../../../shared/extensions/disposable";
import { registerBackgroundOverlays } from "./background";
import { registerLayoutProfiles } from "./layoutProfile";
import { registerLyricsCardStyles } from "./lyricsCard";
import { registerLyricsEffects } from "./lyricsEffect";
import { registerLyricsEngines } from "./lyricsEngine";
import { registerLyricsSources } from "./lyricsSource";
import { registerMusicSources } from "./musicSource";
import { registerSpectrumStyles } from "./spectrum";
import { registerStatsWidgets } from "./statsWidget";
import { registerTranslationProviders } from "./translation";
import { registerTransliterationProviders } from "./transliteration";
import { registerWindowModes } from "./windowMode";

/** 内置扩展点的统一 pluginId */
export const BUILTIN_PLUGIN_ID = "soto.builtin";

/**
 * 注册所有内置扩展点到 12 个 Registry
 *
 * @returns CompositeDisposable，dispose 时撤销全部注册
 */
export const registerBuiltinExtensions = (): Disposable => {
  const composite = new CompositeDisposable();

  // 阶段 3.1：注册 4 套内置歌词卡片样式（classic/compact/poster/minimal）
  composite.add(registerLyricsCardStyles());
  // 阶段 3.2：注册 3 套内置频谱样式（bottom-bars/bottom-curve/around-radial）
  composite.add(registerSpectrumStyles());
  // 阶段 3.3：注册 3 套内置背景叠加（fog/snow/raindrop）
  composite.add(registerBackgroundOverlays());
  // 阶段 3.4：注册 3 个内置音源（netease/qqmusic/kugou）
  composite.add(registerMusicSources());
  // 阶段 3.5：注册 2 个内置歌词源（netease/qqmusic）
  composite.add(registerLyricsSources());
  // 阶段 3.6：注册 4 个内置窗口模式（standard/desktop/taskbar/dynamicIsland）
  composite.add(registerWindowModes());
  // 阶段 4.1：注册 4 个内置歌词效果（fade/slide/scale/blur）
  composite.add(registerLyricsEffects());
  // 阶段 4.2：注册 4 套内置布局配置（standard/stacked/cover-focused/minimal）
  composite.add(registerLayoutProfiles());
  // 阶段 4.3：注册 2 个内置歌词引擎（dom/canvas）
  composite.add(registerLyricsEngines());
  // 阶段 4.4：注册 3 个内置统计小部件（play-count/playtime/recent-tracks）
  composite.add(registerStatsWidgets());
  // 阶段 4.5：注册 2 个内置翻译提供方（local-dict/builtin-offline）
  composite.add(registerTranslationProviders());
  // 阶段 4.6：注册 2 个内置音译提供方（local-romaji/builtin-pinyin）
  composite.add(registerTransliterationProviders());

  return composite;
};
