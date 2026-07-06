import type { LyricFormat } from "@shared/types/lyrics";
import { DEFAULT_LYRIC_FORMAT_ORDER as DEFAULT_LYRIC_FORMAT_ORDER_SHARED } from "@shared/types/lyrics";
import type { Platform } from "@shared/types/platform";
import { ALL_PLATFORMS } from "@shared/types/platform";
import type { QualityLevel } from "@/utils/quality";

/** 播放器背景类型 */
export type PlayerBgType = "blur" | "solid";
export type CoverLayout = "default" | "fullscreen";

/**
 * 歌词来源偏好
 * - auto：智能选择（按打分结果）
 * - Platform（netease / qqmusic / kugou…）：优先该平台
 * - self：跟随歌曲自身来源平台
 */
export type LyricSourcePreference = Platform | "auto" | "self";

/** 布局模式 */
export type LayoutMode = "default" | "sidebar-full" | "floating";

/** 路由切换动效 */
export type RouteTransition = "none" | "fade" | "slide" | "zoom";

/** 弹簧动画预设 */
export type SpringPreset =
  | "default"
  | "smooth"
  | "responsive"
  | "jello"
  | "heavy"
  | "noBounce"
  | "custom";

/** 弹簧预设参数映射 */
export const SPRING_PRESETS: Record<
  Exclude<SpringPreset, "custom">,
  { mass: number; damping: number; stiffness: number }
> = {
  default: { mass: 0.9, damping: 15, stiffness: 90 },
  smooth: { mass: 1.2, damping: 22, stiffness: 80 },
  responsive: { mass: 0.5, damping: 18, stiffness: 150 },
  jello: { mass: 0.6, damping: 8, stiffness: 120 },
  heavy: { mass: 2.0, damping: 25, stiffness: 60 },
  noBounce: { mass: 1.0, damping: 30, stiffness: 100 },
};

/** 音源排序：来源偏好为「智能选择」时，按此顺序依次尝试匹配 */
export type LyricSourceOrder = Platform[];

/** 歌词格式优先级：决定多种格式可用时的选择，以及 TTML 是否覆盖平台主格式 */
export type LyricFormatOrder = LyricFormat[];

/** 默认音源顺序 */
export const DEFAULT_LYRIC_SOURCE_ORDER: LyricSourceOrder = [...ALL_PLATFORMS];

/** 默认格式优先级 */
export const DEFAULT_LYRIC_FORMAT_ORDER: LyricFormatOrder = [...DEFAULT_LYRIC_FORMAT_ORDER_SHARED];

/**
 * 歌词滚动方向
 * - natural：内容随手势同向移动（鼠标向下滚 → 内容向下移 → 露出上方内容），Mac 习惯
 * - reverse：内容随手势反向移动（鼠标向下滚 → 内容向上移 → 露出下方内容），Windows 习惯
 */
export type LyricScrollDirection = "natural" | "reverse";

/** 歌词设置 */
export interface LyricSettings {
  /** 歌词来源偏好 */
  lyricSourcePreference: LyricSourcePreference;
  /** 音源顺序 */
  lyricSourceOrder: LyricSourceOrder;
  /** 歌词格式优先级 */
  lyricFormatOrder: LyricFormatOrder;
  /** 智能选择是否优先在线 */
  smartPreferOnline: boolean;
  /** 字号自适应窗口大小 */
  adaptiveFontSize: boolean;
  /** 歌词字号（px，自适应关闭时生效） */
  fontSize: number;
  /** 歌词字重（100~900） */
  fontWeight: number;
  /** 歌词字体 */
  fontFamily: string;
  /** 是否显示翻译歌词 */
  showTranslation: boolean;
  /** 是否显示音译歌词 */
  showRomanization: boolean;
  /** 逐字高亮效果 */
  enableWordHighlight: boolean;
  /** 逐字上浮动画 */
  enableFloatAnimation: boolean;
  /** 强调效果（缩放 + 辉光 + 正弦浮动） */
  enableEmphasizeEffect: boolean;
  /** 逐行模糊效果 */
  enableBlur: boolean;
  /** 隐藏已播放行 */
  hidePassedLines: boolean;
  /** 弹簧动画预设 */
  springPreset: SpringPreset;
  /** 弹簧质量 */
  springMass: number;
  /** 弹簧阻尼 */
  springDamping: number;
  /** 弹簧刚度 */
  springStiffness: number;
  /** 激活行对齐位置（0~1） */
  alignPosition: number;
  /** 逐字掩码渐变宽度 */
  wordFadeWidth: number;
  /** 非激活行透明度 */
  inactiveAlpha: number;
  /** 启用歌词排除 */
  enableExcludeLyrics: boolean;
  /** 用户自定义关键词 */
  excludeLyricsUserKeywords: string[];
  /** 用户自定义正则 */
  excludeLyricsUserRegexes: string[];
  /** 歌词滚动方向：natural=内容随手势同向（Mac 习惯），reverse=内容随手势反向（Windows 习惯） */
  lyricScrollDirection: LyricScrollDirection;
  /** AMLL：启用弹簧动画 */
  useAMSpring: boolean;
  /** AMLL：垂直弹簧质量 */
  amllVerticalSpringMass: number;
  /** AMLL：垂直弹簧阻尼 */
  amllVerticalSpringDamping: number;
  /** AMLL：垂直弹簧刚度 */
  amllVerticalSpringStiffness: number;
  /** AMLL：垂直弹簧柔和 */
  amllVerticalSpringSoft: boolean;
  /** AMLL：缩放弹簧质量 */
  amllScaleSpringMass: number;
  /** AMLL：缩放弹簧阻尼 */
  amllScaleSpringDamping: number;
  /** AMLL：缩放弹簧刚度 */
  amllScaleSpringStiffness: number;
  /** AMLL：缩放弹簧柔和 */
  amllScaleSpringSoft: boolean;
}

/** 播放器设置 */
export interface PlayerSettings {
  /** 播放器背景类型 */
  playerBgType: PlayerBgType;
  /** 全屏播放器封面布局 */
  coverLayout: CoverLayout;
  /** 镜像布局：左右翻转封面与歌词位置（居中状态强制不生效） */
  mirrorLayout: boolean;
  /** 无歌词时自动居中封面并隐藏歌词区域 */
  autoCenterCover: boolean;
  /** 纯音乐时展示热评（与 autoCenterCover 互斥；二者均开启时热评优先） */
  showPureMusicComment: boolean;
  /** 颜色是否跟随封面 */
  followCoverColor: boolean;
  /** 全屏播放器自动进入沉浸模式（隐藏顶/底栏与鼠标） */
  autoImmersive: boolean;
  /** 输出设备名称，null 表示跟随系统默认 */
  outputDevice: string | null;
  /** 切换输出设备时暂停播放 */
  pauseOnDeviceSwitch: boolean;
  /** 是否启用音乐频谱可视化 */
  enableSpectrum: boolean;
  /** 频谱单条宽度（px） */
  spectrumBarWidth: number;
  /** 在线歌曲音质偏好；实际可用级别取决于账号权限 */
  songLevel: QualityLevel;
  /** 是否启用流体背景 */
  enableFluidBackground: boolean;
  /** 是否启用封面3D视差倾斜 */
  enableParallaxTilt: boolean;
  /** 是否启用封面呼吸效果 */
  enableCoverBreathing: boolean;
  /** 是否启用扇形歌词 */
  enableFanLyrics: boolean;
  /** 扇形歌词每行旋转角度（度） */
  fanLyricsAngle: number;
  /** 扇形歌词单侧可见行数 */
  fanLyricsMaxLines: number;
  /** 扇形歌词行高（px） */
  fanLyricsLineHeight: number;
  /** 扇形歌词最小缩放 */
  fanLyricsMinScale: number;
  /** 扇形歌词最小透明度 */
  fanLyricsMinOpacity: number;
  /** 扇形歌词最大模糊（px） */
  fanLyricsMaxBlur: number;
  /** 扇形歌词是否启用底框背景 */
  fanLyricsEnableBackground: boolean;
  /** 扇形歌词激活行是否始终显示底框（依赖 fanLyricsEnableBackground） */
  fanLyricsAlwaysShowActiveBg: boolean;
  /** 扇形歌词是否启长音节光辉 */
  fanLyricsEnableGlow: boolean;
  /** 频谱灵敏度（增益倍数） */
  spectrumSensitivity: number;
  /** 频谱最大高度比例（0~1） */
  spectrumMaxHeight: number;
  /** 频谱平滑度(0~1,越大越平滑) */
  spectrumSmoothing: number;
  /** 频谱样式:bar 矩形柱 / curve Catmull-Rom 平滑曲线 / around 环绕封面径向 */
  spectrumStyle: "bar" | "curve" | "around";
  /** 频谱心跳：低频驱动整体等比放大（BetterLyrics 风格） */
  spectrumBreathing: boolean;
  /** 频谱心跳强度（0~100，控制最大放大倍率，100 时最大 1.8x） */
  spectrumBreathingIntensity: number;
  /** 频谱亮度固定值(0.3~1.0),智能模式开启时在此基础上叠加调暗 */
  spectrumBrightness: number;
  /** 频谱智能调暗:鼠标悬浮播放界面控件时自动降低亮度和饱和度以突出控件 */
  spectrumSmartDim: boolean;
  /** FFT 等响度补偿(BetterLyrics 风格:20Hz gain=1.0 → 20kHz gain=12.0 对数插值,强化高频视觉) */
  fftEqualLoudness: boolean;
  /** 频谱颜色模式:cover 跟随封面色 / custom 自定义颜色 */
  spectrumColorMode: "cover" | "custom";
  /** 频谱自定义颜色(hex),仅 spectrumColorMode=custom 时生效 */
  spectrumCustomColor: string;
  /** 是否启用雪花背景层 */
  enableSnowBackground: boolean;
  /** 是否启用雾气背景层 */
  enableFogBackground: boolean;
  /** 是否启用雨滴背景层 */
  enableRaindropBackground: boolean;
  /** 流体背景：暂停时冻结 */
  playerBgFreezeOnPause: boolean;
  /** 流体背景：目标帧率 */
  playerBgFps: number;
  /** 流体背景：流动速度 */
  playerBgFlowSpeed: number;
  /** 流体背景：渲染缩放（0~1） */
  playerBgRenderScale: number;
  /** 流体背景：启用节拍联动 */
  playerBgBeat: boolean;
  /** 流体背景：预设风格 */
  playerBgPreset: "soft" | "vivid" | "intense" | "custom";
  /** 流体背景：亮度（CSS filter brightness） */
  playerBgBrightness: number;
  /** 流体背景：饱和度（CSS filter saturate） */
  playerBgSaturation: number;
  /** 流体背景：对比度（CSS filter contrast） */
  playerBgContrast: number;
  /** 特效自动降级：连续低帧率时自动关闭流体/雾气背景与封面景深，保持播放流畅 */
  enableEffectAutoDowngrade: boolean;
  /**
   * 播放界面控件可见性增强模式
   * - none: 不增强（默认）
   * - background: 控件背景（blur/acrylic/mica，依赖沉浸模式开启）
   * - outline: 描边（thin/shadow）
   * - auto: 智能推演（根据下层颜色实时计算对比色）
   */
  controlEnhanceMode: ControlEnhanceMode;
  /** 控件背景风格（仅 controlEnhanceMode=background 生效） */
  controlBackgroundStyle: ControlBackgroundStyle;
  /** 控件描边风格（仅 controlEnhanceMode=outline 生效） */
  controlOutlineStyle: ControlOutlineStyle;
}

/** 控件可见性增强模式 */
export type ControlEnhanceMode = "none" | "background" | "outline" | "auto";

/** 控件背景风格 */
export type ControlBackgroundStyle = "blur" | "acrylic" | "mica";

/** 控件描边风格 */
export type ControlOutlineStyle = "thin" | "shadow" | "glow";

/** 外观设置 */
export interface AppearanceSettings {
  /** 布局模式 */
  layoutMode: LayoutMode;
  /** 路由切换动效 */
  routeTransition: RouteTransition;
  /** 侧边栏折叠 */
  sidebarCollapsed: boolean;
  /** 侧边栏歌单项显示封面 */
  sidebarPlaylistCover: boolean;
  /** 播放栏显示快捷音质切换 */
  showQualitySwitch: boolean;
  /** 点击关闭按钮的行为 */
  closeAction: "quit" | "hide";
  /** 记忆关闭选择 */
  rememberCloseChoice: boolean;
  /** 全局字体 */
  fontFamily: string;
  /** 性能监视器悬浮卡片 */
  showPerformanceMonitor: boolean;
  /** 背景图片视差（仅 coverLayout=fullscreen 时生效） */
  coverParallax: boolean;
  /** 视差强度（0~100，控制背景放大与视差幅度） */
  coverParallaxIntensity: number;
  /** 视差模式：plane=平面平移 / multi=多维透视倾斜（实验性） */
  coverParallaxMode: "plane" | "multi";
  /** 工具栏默认值迁移标记（一次性回退 showQualitySwitch 到 true，避免旧版本持久化 false） */
  _toolbarDefaultsV2?: boolean;
}