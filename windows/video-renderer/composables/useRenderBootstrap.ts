/**
 * 渲染窗口启动引导
 *
 * 在收到主进程下发的 RenderWindowConfig 后调用，完成以下初始化：
 *
 * 1. settings store：deep-merge 用户设置快照（locale/appearance/player/lyric/system）
 *    —— 保证"所见即所得"，渲染输出视觉与主播放界面完全一致
 * 2. media store：写入 track + parsedLyric（歌词已由主窗口预解析）
 * 3. status store：强制 isExpanded=true / state=playing / trackLoading=false
 *    —— FullPlayer 由 isExpanded 控制显隐，state=playing 让频谱/呼吸等特效进入活跃态
 * 4. playback 服务：setDuration / setPlaying(true) / setCurrentTime(0, force)
 *    —— FullPlayer 内部 usePlaybackTime 从 playback 服务读取时间驱动歌词逐字高亮
 * 5. fftCapture：启用本地 FFT 模式，acquireFft/releaseFft 跳过 IPC
 *    —— FFT 数据由本窗口 AnalyserNode 通过 playback.setFftFrame 注入
 *
 * 注：渲染窗口使用独立 session partition（persist:video-renderer），
 * localStorage 与主窗口隔离，piniaPersistedstate 会以默认值初始化 settings store，
 * 必须调用 applySnapshot 才能覆盖为用户真实设置。
 *
 * 歌词防覆盖：applySnapshot 可能触发 lyricLoader 的偏好变化 watch → refreshPreference
 * 重新拉取在线歌词，覆盖主窗口已预解析下发的 parsedLyric。调用 setAutoLoadEnabled(false)
 * 关闭自动加载，保证渲染窗口直接使用主窗口下发的预解析歌词。
 */

import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";
import * as playback from "@/services/playback";
import { setLocalFftMode } from "@/services/fftCapture";
import { setAutoLoadEnabled } from "@/services/lyricLoader";
import { setVideoRendererFlag } from "@/composables/useVideoRendererFlag";
import type { RenderWindowConfig } from "@shared/types/renderVideo";

/** 防止重复初始化（同一窗口生命周期内只引导一次） */
let initialized = false;

/**
 * 渲染窗口启动引导
 *
 * @param cfg 主进程下发的渲染配置（含 track / lyricLines / settingsSnapshot / themeSnapshot）
 */
export const useRenderBootstrap = (): {
  bootstrap: (cfg: RenderWindowConfig) => void;
} => {
  const settings = useSettingsStore();
  const status = useStatusStore();
  const media = useMediaStore();
  const theme = useThemeStore();

  const bootstrap = (cfg: RenderWindowConfig): void => {
    // 首次引导：关闭歌词自动加载 + 设置视频渲染窗口标志
    if (!initialized) {
      setAutoLoadEnabled(false);
      // 让 PlayerCover 等共享组件跳过依赖主进程 audio-engine 的 IPC（如 getCoverRaw
      // 返回的是主窗口当前 track 的封面，会错误覆盖渲染窗口 track 的封面）
      setVideoRendererFlag(true);
      initialized = true;
    }

    // 1. 应用设置快照（deep-merge，保证视觉与主窗口一致）
    settings.applySnapshot(cfg.settingsSnapshot);

    // 1.5 应用主题快照（覆盖 mode/source/customColor/globalTint/appearanceStyle/
    // imageBackground/imageBackgroundColor 七字段，触发 theme store 内部 watch → apply()
    // 重写 CSS 变量与 data-appearance-style/data-theme-style 属性）
    // 必须在 settings.applySnapshot 之后调用：theme.apply() 依赖 settings.system.system.themeStyle
    theme.applySnapshot(cfg.themeSnapshot);
    // 诊断日志：确认 theme store 实际状态
    // eslint-disable-next-line no-console
    console.info(
      `[render-bootstrap] theme: mode=${theme.mode} source=${theme.source} coverColor=${theme.coverColor} customColor=${theme.customColor} appearanceStyle=${theme.appearanceStyle} globalTint=${theme.globalTint}`,
    );
    // eslint-disable-next-line no-console
    console.info(
      `[render-bootstrap] settings: themeStyle=${settings.system.system.themeStyle} enableFluidBackground=${settings.player.enableFluidBackground} spectrumColorMode=${settings.player.spectrumColorMode}`,
    );
    // 用 setTimeout 让 apply() 有机会执行后再读 CSS 变量
    setTimeout(() => {
      const sCover = getComputedStyle(document.documentElement).getPropertyValue("--s-cover");
      const sPrimary = getComputedStyle(document.documentElement).getPropertyValue("--s-primary");
      const dataThemeStyle = document.documentElement.dataset.themeStyle;
      const dataAppearanceStyle = document.documentElement.dataset.appearanceStyle;
      const isDarkClass = document.documentElement.classList.contains("dark");
      // eslint-disable-next-line no-console
      console.info(
        `[render-bootstrap-after-apply] --s-cover="${sCover.trim()}" --s-primary="${sPrimary.trim()}" data-theme-style=${dataThemeStyle} data-appearance-style=${dataAppearanceStyle} dark=${isDarkClass}`,
      );
    }, 300);

    // 2. 写入曲目 + 预解析歌词
    // setTrack 仅写入 track.value（shallowRef），不触发歌词拉取
    media.setTrack(cfg.track);
    // 直接写入 parsedLyric（shallowRef 暴露为可赋值属性）
    // FullPlayer 通过 media.parsedLyric 传给 <Lyrics> 组件
    media.parsedLyric = cfg.lyricLines;
    media.lyricLoading = false;

    // 3. 强制展开播放界面 + 播放态
    // isExpanded=true 让 FullPlayer 的 v-show 进入可见态
    // state="playing" 让 isPlaying computed 为 true，频谱/呼吸/流体背景进入活跃态
    status.isExpanded = true;
    status.state = "playing";
    status.trackLoading = false;
    status.duration = cfg.track.duration ?? 0;
    status.position = 0;

    // 4. 初始化 playback 服务（非响应式时间源）
    // FullPlayer 内部 usePlaybackTime 从 getCurrentTime() 读取时间驱动歌词
    playback.setDuration(cfg.track.duration ?? 0);
    playback.setPlaying(true);
    playback.setCurrentTime(0, { force: true });

    // 5. 启用本地 FFT 模式
    // acquireFft/releaseFft 跳过 window.api.player.setFftEnabled IPC
    // FFT 数据由本窗口 AnalyserNode 通过 playback.setFftFrame 注入
    setLocalFftMode(true);
  };

  return { bootstrap };
};
