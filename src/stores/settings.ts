import type {
  PlayerSettings,
  LyricSettings,
  AppearanceSettings,
  SpringPreset,
} from "@/types/settings";
import {
  DEFAULT_LYRIC_FORMAT_ORDER,
  DEFAULT_LYRIC_SOURCE_ORDER,
  SPRING_PRESETS,
} from "@/types/settings";
import type { SystemConfig, LocaleCode } from "@shared/types/settings";
import { ALL_PLATFORMS } from "@shared/types/platform";
import { defaultSystemConfig } from "@shared/defaults/settings";
import { setByPath } from "@shared/utils/path";

export const FLUID_BG_PRESETS = {
  soft: {
    playerBgFlowSpeed: 1,
    playerBgRenderScale: 0.5,
    playerBgBeat: false,
    playerBgBrightness: 1.0,
    playerBgSaturation: 1.0,
    playerBgContrast: 1.0,
  },
  vivid: {
    playerBgFlowSpeed: 2,
    playerBgRenderScale: 0.5,
    playerBgBeat: false,
    playerBgBrightness: 1.2,
    playerBgSaturation: 1.1,
    playerBgContrast: 1.0,
  },
  intense: {
    playerBgFlowSpeed: 4,
    playerBgRenderScale: 0.5,
    playerBgBeat: false,
    playerBgBrightness: 1.5,
    playerBgSaturation: 1.3,
    playerBgContrast: 1.1,
  },
} as const;

export type FluidBgPreset = keyof typeof FLUID_BG_PRESETS;

/**
 * 对账有序集合：保留存档中仍有效的项（顺序不变），
 * 末尾补上完整集合里缺失的新项，剔除已失效的项
 * 用于平台/格式偏好——新增平台或格式时无需用户手动重置即可生效
 * @param stored - 存档顺序
 * @param all - 当前完整集合
 * @returns 对账后的顺序
 */
const reconcileOrder = <T>(stored: T[], all: readonly T[]): T[] => {
  const known = stored.filter((item) => all.includes(item));
  const missing = all.filter((item) => !known.includes(item));
  return [...known, ...missing];
};

export const useSettingsStore = defineStore(
  "settings",
  () => {
    /** 界面语言（持久化，由 main.ts 同步到 vue-i18n） */
    const locale = ref<LocaleCode>("zh-CN");

    /** 外观 */
    const appearance = reactive<AppearanceSettings>({
      layoutMode: "default",
      routeTransition: "fade",
      sidebarCollapsed: false,
      sidebarPlaylistCover: false,
      showQualitySwitch: true,
      closeAction: "hide",
      rememberCloseChoice: false,
      fontFamily: "",
      showPerformanceMonitor: false,
      coverParallax: true,
      coverParallaxIntensity: 60,
      coverParallaxMode: "plane",
    });

    /** 播放器 */
    const player = reactive<PlayerSettings>({
      playerBgType: "blur",
      coverLayout: "default",
      mirrorLayout: false,
      autoCenterCover: true,
      showPureMusicComment: false,
      followCoverColor: true,
      autoImmersive: true,
      outputDevice: null,
      pauseOnDeviceSwitch: false,
      enableSpectrum: true,
      spectrumBarWidth: 4,
      songLevel: "hq",
      enableFluidBackground: true,
      enableParallaxTilt: true,
      enableCoverBreathing: true,
      enableFanLyrics: false,
      fanLyricsAngle: 60,
      fanLyricsMaxLines: 7,
      fanLyricsLineHeight: 56,
      fanLyricsMinScale: 0.78,
      fanLyricsMinOpacity: 0,
      fanLyricsMaxBlur: 7,
      fanLyricsEnableBackground: true,
      fanLyricsAlwaysShowActiveBg: false,
      fanLyricsEnableGlow: true,
      spectrumSensitivity: 1.0,
      spectrumMaxHeight: 5.0,
      spectrumSmoothing: 0.5,
      spectrumStyle: "bar",
      spectrumBreathing: false,
      spectrumBreathingIntensity: 80,
      spectrumBrightness: 1.0,
      spectrumSmartDim: false,
      fftEqualLoudness: true,
      spectrumColorMode: "cover",
      spectrumCustomColor: "#FFFFFF",
      enableSnowBackground: false,
      enableFogBackground: false,
      enableRaindropBackground: false,
      playerBgFreezeOnPause: false,
      playerBgFps: 30,
      playerBgFlowSpeed: 2,
      playerBgRenderScale: 0.5,
      playerBgBeat: false,
      playerBgPreset: "vivid",
      playerBgBrightness: 1.2,
      playerBgSaturation: 1.1,
      playerBgContrast: 1.0,
      enableEffectAutoDowngrade: true,
      controlEnhanceMode: "none",
      controlBackgroundStyle: "blur",
      controlOutlineStyle: "thin",
    });

    /** 歌词 */
    const lyric = reactive<LyricSettings>({
      lyricSourcePreference: "auto",
      lyricSourceOrder: [...DEFAULT_LYRIC_SOURCE_ORDER],
      lyricFormatOrder: [...DEFAULT_LYRIC_FORMAT_ORDER],
      smartPreferOnline: false,
      adaptiveFontSize: true,
      fontSize: 48,
      fontWeight: 700,
      fontFamily: "Arial",
      showTranslation: true,
      showRomanization: true,
      enableWordHighlight: true,
      enableFloatAnimation: false,
      enableEmphasizeEffect: false,
      enableBlur: false,
      hidePassedLines: false,
      springPreset: "default",
      springMass: 0.9,
      springDamping: 15,
      springStiffness: 90,
      alignPosition: 0.35,
      wordFadeWidth: 0.5,
      inactiveAlpha: 0.3,
      enableExcludeLyrics: true,
      excludeLyricsUserKeywords: [],
      excludeLyricsUserRegexes: [],
      // 滚动方向默认按系统习惯：Mac=natural，Windows/Linux=reverse
      lyricScrollDirection: navigator.platform.toLowerCase().includes("mac")
        ? "natural"
        : "reverse",
      useAMSpring: true,
      amllVerticalSpringMass: 0.9,
      amllVerticalSpringDamping: 15,
      amllVerticalSpringStiffness: 90,
      amllVerticalSpringSoft: false,
      amllScaleSpringMass: 0.9,
      amllScaleSpringDamping: 15,
      amllScaleSpringStiffness: 90,
      amllScaleSpringSoft: false,
    });

    /** 系统配置 - 传递主进程 */
    const system = reactive<SystemConfig>(structuredClone(defaultSystemConfig));

    /** 桌面歌词窗口是否打开；由主进程广播 */
    const isDesktopLyricOpen = ref(false);

    /** 灵动岛窗口是否打开；由主进程广播 */
    const isDynamicIslandOpen = ref(false);

    /** 任务栏歌词窗口是否打开；由主进程广播 */
    const isTaskbarLyricOpen = ref(false);

    /**
     * 深合并：嵌套对象原地 mutate，叶子值不变就不写
     * 避免浅 Object.assign 替换嵌套引用，导致依赖路径的 watcher 误触
     */
    const deepAssign = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
      for (const key of Object.keys(source)) {
        const next = source[key];
        const cur = target[key];
        if (
          next &&
          typeof next === "object" &&
          !Array.isArray(next) &&
          cur &&
          typeof cur === "object" &&
          !Array.isArray(cur)
        ) {
          deepAssign(cur as Record<string, unknown>, next as Record<string, unknown>);
        } else if (cur !== next) {
          target[key] = next;
        }
      }
    };

    /** 从主进程拉取后端配置 */
    const syncSystem = async (): Promise<void> => {
      try {
        deepAssign(
          system as unknown as Record<string, unknown>,
          (await window.api.config.getAll()) as unknown as Record<string, unknown>,
        );
      } catch {}
    };

    /** IPC 订阅取消回调集合 */
    const unsubscribers: Array<() => void> = [
      // 订阅桌面歌词配置变化：歌词窗口点锁定按钮等场景需要回流到主窗口设置页
      window.api.desktopLyric.onConfigChange((next) => {
        Object.assign(system.desktopLyric, next as object);
      }),
      // 订阅桌面歌词窗口开关状态
      window.api.window.onDesktopLyricVisibilityChange((open) => {
        isDesktopLyricOpen.value = open;
      }),
      // 订阅灵动岛配置变化
      window.api.dynamicIsland.onConfigChange((next) => {
        Object.assign(system.dynamicIsland, next as object);
      }),
      // 订阅灵动岛窗口开关状态
      window.api.window.onDynamicIslandVisibilityChange((open) => {
        isDynamicIslandOpen.value = open;
      }),
      // 订阅任务栏歌词窗口开关状态
      window.api.window.onTaskbarLyricVisibilityChange((open) => {
        isTaskbarLyricOpen.value = open;
      }),
    ];

    onScopeDispose(() => {
      for (const off of unsubscribers) off();
      unsubscribers.length = 0;
    });

    // 拉取窗口初始开关状态
    window.api.window
      .isDesktopLyricOpen()
      .then((open) => {
        isDesktopLyricOpen.value = open;
      })
      .catch(() => {});
    window.api.window
      .isDynamicIslandOpen()
      .then((open) => {
        isDynamicIslandOpen.value = open;
      })
      .catch(() => {});
    window.api.window
      .isTaskbarLyricOpen()
      .then((open) => {
        isTaskbarLyricOpen.value = open;
      })
      .catch(() => {});

    /**
     * 写入后端配置并同步本地
     * 先就地 mutate 叶子保证 UI 即时反馈，IPC 落盘异步执行
     */
    const setSystem = async (keyPath: string, value: unknown): Promise<void> => {
      setByPath(system, keyPath, value);
      window.api.config.set(keyPath, value).catch((err) => {
        console.error("[settings] config.set failed", keyPath, err);
      });
      if (keyPath === "player.fadeEnabled" || keyPath === "player.fadeDuration") {
        await window.api.player.setFadeDuration(
          system.player.fadeEnabled ? system.player.fadeDuration : 0,
        );
      }
    };

    /** 本地配置写入后处理 */
    const afterLocalChange = (path: string, value: unknown): void => {
      if (path === "lyric.springPreset" && value !== "custom") {
        const params = SPRING_PRESETS[value as Exclude<SpringPreset, "custom">];
        lyric.springMass = params.mass;
        lyric.springDamping = params.damping;
        lyric.springStiffness = params.stiffness;
      }
      if (path === "player.playerBgPreset" && value !== "custom") {
        const preset = FLUID_BG_PRESETS[value as FluidBgPreset];
        if (preset) {
          player.playerBgFlowSpeed = preset.playerBgFlowSpeed;
          player.playerBgRenderScale = preset.playerBgRenderScale;
          player.playerBgBeat = preset.playerBgBeat;
          player.playerBgBrightness = preset.playerBgBrightness;
          player.playerBgSaturation = preset.playerBgSaturation;
          player.playerBgContrast = preset.playerBgContrast;
        }
      }
      if (
        path.startsWith("player.playerBg") &&
        path !== "player.playerBgPreset" &&
        path !== "player.playerBgFps" &&
        path !== "player.playerBgFreezeOnPause" &&
        player.playerBgPreset !== "custom"
      ) {
        player.playerBgPreset = "custom";
      }
    };

    return {
      locale,
      appearance,
      player,
      lyric,
      system,
      isDesktopLyricOpen,
      isDynamicIslandOpen,
      isTaskbarLyricOpen,
      syncSystem,
      setSystem,
      afterLocalChange,
    };
  },
  {
    persist: {
      storage: localStorage,
      key: "soto-player:settings",
      omit: ["system"],
      afterHydrate: ({ store }) => {
        const { lyric } = store as unknown as { lyric: LyricSettings };
        lyric.lyricSourceOrder = reconcileOrder(lyric.lyricSourceOrder, ALL_PLATFORMS);
        lyric.lyricFormatOrder = reconcileOrder(lyric.lyricFormatOrder, DEFAULT_LYRIC_FORMAT_ORDER);
        // showQualitySwitch 一次性迁移：旧版本可能持久化为 false 或非 boolean，
        // 导致 Toolbar 中 v-if 失效、音质按钮不渲染。用 _toolbarDefaultsV2 标记位
        // 保证一次性回退到默认 true，之后仍尊重用户手动关闭的选择
        const { appearance } = store as unknown as { appearance: AppearanceSettings };
        if (!appearance._toolbarDefaultsV2) {
          appearance.showQualitySwitch = true;
          appearance._toolbarDefaultsV2 = true;
        } else if (typeof appearance.showQualitySwitch !== "boolean") {
          appearance.showQualitySwitch = true;
        }
        // 播放器默认值一次性迁移：原版 SPlayer-Next 用同一 localStorage origin（file://），
        // 其持久化的 enableSpectrum:false / autoCenterCover:false 等旧值会覆盖新默认值，
        // 导致频谱不显示、封面不居中等"功能瘫痪"。用 _playerDefaultsV2 标记位一次性回退
        const { player } = store as unknown as { player: PlayerSettings };
        if (!(player as unknown as { _playerDefaultsV2?: boolean })._playerDefaultsV2) {
          player.enableSpectrum = true;
          player.autoCenterCover = true;
          player.followCoverColor = true;
          player.enableFluidBackground = true;
          player.enableCoverBreathing = true;
          player.enableParallaxTilt = true;
          // showPureMusicComment 与 autoCenterCover 互斥：热评开启时封面不居中。
          // 用户期望纯音乐时封面居中，故默认关闭热评；用户可手动重新开启
          player.showPureMusicComment = false;
          (player as unknown as { _playerDefaultsV2?: boolean })._playerDefaultsV2 = true;
        }
        // 视差字段迁移：旧版本是 coverDepthOfField / coverDepthIntensity / coverDepthMouseFollow
        // 新版本改为 coverParallax / coverParallaxIntensity / coverParallaxMode
        if (typeof appearance.coverParallax !== "boolean") {
          // 旧字段存在则沿用其开关值，否则默认 true
          const oldFlag = (appearance as unknown as { coverDepthOfField?: boolean }).coverDepthOfField;
          appearance.coverParallax = oldFlag ?? true;
        }
        if (typeof appearance.coverParallaxIntensity !== "number") {
          const oldIntensity = (appearance as unknown as { coverDepthIntensity?: number }).coverDepthIntensity;
          appearance.coverParallaxIntensity = oldIntensity ?? 60;
        }
        if (appearance.coverParallaxMode !== "plane" && appearance.coverParallaxMode !== "multi") {
          appearance.coverParallaxMode = "plane";
        }
        // 清理旧字段
        delete (appearance as unknown as { coverDepthOfField?: boolean }).coverDepthOfField;
        delete (appearance as unknown as { coverDepthIntensity?: number }).coverDepthIntensity;
        delete (appearance as unknown as { coverDepthMouseFollow?: boolean }).coverDepthMouseFollow;

        // 频谱参数合法性校验：原版污染可能导致 spectrumSensitivity=0、
        // spectrumMaxHeight=0、spectrumStyle 为非法值等，使频谱条不可见。
        // 每次启动都校验，不依赖一次性标记位（用户手动改到非法值也能恢复）
        if (typeof player.spectrumSensitivity !== "number" || player.spectrumSensitivity <= 0) {
          player.spectrumSensitivity = 1.0;
        }
        if (typeof player.spectrumMaxHeight !== "number" || player.spectrumMaxHeight < 0.3) {
          player.spectrumMaxHeight = 5.0;
        }
        if (typeof player.spectrumSmoothing !== "number" || player.spectrumSmoothing < 0) {
          player.spectrumSmoothing = 0.5;
        }
        if (typeof player.spectrumBarWidth !== "number" || player.spectrumBarWidth < 1) {
          player.spectrumBarWidth = 4;
        }
        if (
          player.spectrumStyle !== "bar" &&
          player.spectrumStyle !== "curve" &&
          player.spectrumStyle !== "around"
        ) {
          player.spectrumStyle = "bar";
        }
        if (
          typeof player.spectrumBrightness !== "number" ||
          player.spectrumBrightness < 0.3 ||
          player.spectrumBrightness > 1
        ) {
          player.spectrumBrightness = 1.0;
        }
        if (typeof player.spectrumSmartDim !== "boolean") {
          player.spectrumSmartDim = false;
        }
        if (player.spectrumColorMode !== "cover" && player.spectrumColorMode !== "custom") {
          player.spectrumColorMode = "cover";
        }
        if (typeof player.spectrumCustomColor !== "string" || !player.spectrumCustomColor) {
          player.spectrumCustomColor = "#FFFFFF";
        }
        // fanLyricsLineHeight 旧默认 96 偏大（7行需 728px），新默认 56。
        // 仅迁移恰好等于旧默认值的情形，用户手动调过的非 96 值保留
        if (player.fanLyricsLineHeight === 96) {
          player.fanLyricsLineHeight = 56;
        }
      },
    },
  },
);