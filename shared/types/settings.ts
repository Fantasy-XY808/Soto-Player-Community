import type { PluginsConfig, PluginQuality } from "./plugin";
import type { HotkeyConfig } from "./hotkey";
import type { DownloadLyricFormat, DownloadFolderScheme } from "./download";

/** 支持的语言代码 */
export type LocaleCode = "zh-CN" | "en-US";

/** 语言选项 */
export const LOCALES: { value: LocaleCode; label: string }[] = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English" },
];

/** 均衡器预设标识（含自定义预设引用 `custom:${id}`） */
export type EqualizerPreset =
  | "flat"
  | "custom"
  | "pop"
  | "rock"
  | "classical"
  | "electronic"
  | "bass"
  | "vocal"
  | "dance"
  | "soft"
  | `custom:${string}`;

/** 均衡器滤波器类型（与 Rust `FilterType` 一一对应） */
export enum EqualizerFilterType {
  /** 通带（无滤波） */
  Passthrough = 0,
  /** 钟形滤波器（指定频率处峰值增益） */
  Peaking = 1,
  /** 低频架桥（指定频率以下整体增益/衰减） */
  LowShelf = 2,
  /** 高频架桥（指定频率以上整体增益/衰减） */
  HighShelf = 3,
  /** 低通（指定频率以上衰减） */
  LowPass = 4,
  /** 高通（指定频率以下衰减） */
  HighPass = 5,
  /** 陷波（指定频率处衰减） */
  Notch = 6,
  /** 带通（仅指定频率附近通过） */
  BandPass = 7,
}

/** 单个均衡器频段参数 */
export interface EqualizerBand {
  /** 中心频率（Hz），范围 [20, 20000] */
  freq: number;
  /** Q 值（带宽），范围 [0.1, 24] */
  q: number;
  /** 增益（dB），范围 [-15, 15] */
  gain: number;
  /** 滤波器类型，取值见 EqualizerFilterType */
  filterType: number;
}

/** 自定义均衡器预设 */
export interface EqualizerCustomPreset {
  /** 预设唯一 id（uuid） */
  id: string;
  /** 预设名称 */
  name: string;
  /** 频段参数 */
  bands: EqualizerBand[];
  /** 前级增益（dB） */
  preamp: number;
  /** 低音增益（dB） */
  bassBoost: number;
  /** 高音增益（dB） */
  trebleBoost: number;
  /** 环绕声增益（倍数） */
  surround: number;
}

/** 均衡器配置 */
export interface EqualizerSettings {
  /** 是否启用均衡器 */
  enabled: boolean;
  /** 当前选中的预设 */
  preset: EqualizerPreset;
  /** 频段参数列表（长度可变，最多 32 段） */
  bands: EqualizerBand[];
  /** 前级增益（dB），范围 [-12, 12] */
  preamp: number;
  /** 低音增益（dB），范围 [-12, 12]，200Hz 以下 low-shelf */
  bassBoost: number;
  /** 高音增益（dB），范围 [-12, 12]，3500Hz 以上 high-shelf */
  trebleBoost: number;
  /** 环绕声增益（倍数，1.0 = 原始，>1 扩展立体声场），范围 [0, 3] */
  surround: number;
  /** A/B bypass：true 时跳过所有滤波器（用于对比效果） */
  bypass: boolean;
  /** 用户保存的自定义预设列表 */
  customPresets: EqualizerCustomPreset[];
}

/** 音频超分后端选择（与 Rust 侧 SuperResBackend::to_u8 对齐） */
export type AudioSuperResolutionBackend = 0 | 1 | 2;

/** 音频超分配置 */
export interface AudioSuperResolutionSettings {
  /** 是否启用超分（高频激励器），默认关闭 */
  enabled: boolean;
  /** 后端：0=CPU, 1=GPU, 2=NPU；GPU/NPU 不可用时回退到 CPU */
  backend: AudioSuperResolutionBackend;
}

/** 播放器配置 */
export interface PlayerSettings {
  /** 加载后自动播放 */
  autoPlay: boolean;
  /** 记忆上次播放的歌曲 */
  rememberLastTrack: boolean;
  /** 是否启用渐入渐出 */
  fadeEnabled: boolean;
  /** 渐入渐出时长（毫秒） */
  fadeDuration: number;
  /** 输出设备名称，null 为系统默认 */
  outputDevice: string | null;
  /** 默认音量（0.0 ~ 1.0） */
  volume: number;
  /** 音量均衡（响度归一化） */
  loudnessNormalization: boolean;
  /** 均衡器配置 */
  equalizer: EqualizerSettings;
  /** 音频超分配置（高频激励器，提升高频细节） */
  audioSuperResolution: AudioSuperResolutionSettings;
  /** 按 `{Track.id}|{歌词源}` 记忆的歌词偏移（ms，正值为歌词提前）；为 0 时不写入 */
  lyricOffsets: Record<string, number>;
}

/** Discord 显示模式 */
export type DiscordDisplayMode = "name" | "state" | "details";

/** Discord RPC 配置 */
export interface DiscordSettings {
  /** 是否启用 */
  enabled: boolean;
  /** 暂停时是否显示状态 */
  showWhenPaused: boolean;
  /** 显示模式 */
  displayMode: DiscordDisplayMode;
}

/** Last.fm 集成配置 */
export interface LastfmSettings {
  /** 总开关 */
  enabled: boolean;
  /** 记录播放（scrobble） */
  scrobble: boolean;
  /** 正在播放上报 */
  nowPlaying: boolean;
  /** 喜欢同步 */
  loveSync: boolean;
}

/** 媒体集成配置 */
export interface MediaSettings {
  /** 是否启用系统媒体控件（SMTC / MPRIS / MPNowPlaying） */
  systemMediaControls: boolean;
  /** Discord RPC 配置 */
  discord: DiscordSettings;
}

/** 桌面歌词对齐方式 */
export type DesktopLyricAlign = "left" | "center" | "right" | "justify";

/** 桌面歌词配置 */
export interface DesktopLyricSettings {
  /** 字号 */
  fontSize: number;
  /** 字重 */
  fontWeight: number;
  /** 字体 */
  fontFamily: string;
  /** 显示翻译 */
  showTranslation: boolean;
  /** 双行显示 */
  doubleLine: boolean;
  /** 对齐方式 */
  align: DesktopLyricAlign;
  /** 逐字高亮 */
  wordByWord: boolean;
  /** 自动生成逐字效果 */
  autoGenerateWordByWord: boolean;
  /** 已播放颜色 */
  playedColor: string;
  /** 未播放颜色 */
  unplayedColor: string;
  /** 描边颜色 */
  strokeColor: string;
  /** 是否启用文本背景遮罩 */
  backgroundMask: boolean;
  /** 文本背景遮罩颜色 */
  backgroundMaskColor: string;
  /** 是否常驻显示歌曲信息 */
  alwaysShowSongInfo: boolean;
  /** 拖拽时是否把窗口限制在屏幕工作区内 */
  limitBounds: boolean;
  /** 歌词行切换动画 */
  animation: boolean;
  /** 窗口置顶 */
  alwaysOnTop: boolean;
  /** 锁定：鼠标穿透、禁止拖动 */
  locked: boolean;
}

/** 灵动岛背景风格 */
export type IslandBackgroundStyle = "solid" | "glass" | "mica" | "dynamic";

/** 灵动岛频谱样式 */
export type IslandSpectrumStyle = "gradient" | "solid" | "minimal";

/** 灵动岛 mini 模式宽度模式：fixed=固定宽度，adaptive=随歌词内容自适应 */
export type IslandWidthMode = "fixed" | "adaptive";

/** 灵动岛歌词超出时的处理方式：truncate=截断省略号，scroll=滚动显示 */
export type IslandOverflowMode = "truncate" | "scroll";

/** 灵动岛歌词配置 */
export interface DynamicIslandSettings {
  /** 缩放比例（0.5 ~ 2.0），1 = 100%；实际窗口高度由渲染端按基准高度 × 缩放算出 */
  scale: number;
  /** 字重 */
  fontWeight: number;
  /** 字体 */
  fontFamily: string;
  /** 逐字高亮 */
  wordByWord: boolean;
  /** 已播放颜色 */
  playedColor: string;
  /** 未播放颜色 */
  unplayedColor: string;
  /** 背景颜色 */
  backgroundColor: string;
  /** 窗口置顶 */
  alwaysOnTop: boolean;
  /** 吸附时是否居中 */
  snapCentered: boolean;
  /** 水平偏移（像素），仅 snapCentered=false 时生效；正值右移，负值左移 */
  horizontalOffset: number;
  /** macOS 刘海融合 */
  notchFusion: boolean;
  /** 非遮挡模式 */
  nonOcclusive: boolean;
  /** 总是双行 */
  doubleLine: boolean;
  /** 显示翻译 */
  showTranslation: boolean;
  /** 显示频谱 */
  showSpectrum: boolean;
  /** 频谱样式 */
  spectrumStyle: IslandSpectrumStyle;
  /** 启用展开视图 */
  enableExpandedView: boolean;
  /** 展开视图自动收起超时（秒） */
  expandedTimeout: number;
  /** 背景风格 */
  backgroundStyle: IslandBackgroundStyle;
  /** 启用封面翻转动画 */
  enableCoverFlip: boolean;
  /** mini 模式宽度模式：fixed=固定宽度，adaptive=随歌词内容自适应 */
  widthMode: IslandWidthMode;
  /** mini 模式固定宽度（px，widthMode=fixed 时生效） */
  fixedWidth: number;
  /** mini 模式最大宽度（px，widthMode=adaptive 时的上限） */
  maxWidth: number;
  /** 歌词超出时的处理方式 */
  overflowMode: IslandOverflowMode;
}

/** 任务栏歌词位置模式 */
export type TaskbarLyricPosition = "auto" | "left" | "right";

/** 任务栏歌词配色模式：taskbar=跟随任务栏主题，light=强制浅色，dark=强制深色 */
export type TaskbarLyricColorMode = "taskbar" | "taskbarInverse" | "light" | "dark";

/** 任务栏歌词配置（仅 Windows） */
export interface TaskbarLyricSettings {
  /** 位置：auto 根据任务栏对齐方式自动选择，left 固定左侧，right 固定右侧 */
  position: TaskbarLyricPosition;
  /** 宽度自动：开启时占满可用空间，关闭时按 maxWidth 限制 */
  autoMaxWidth: boolean;
  /** 最大宽度（逻辑像素）；仅在 autoMaxWidth 关闭时生效；超出可用空间时仍以可用空间为准 */
  maxWidth: number;
  /** 左边距（逻辑像素），从可用空间左侧扣除 */
  leftMargin: number;
  /** 右边距（逻辑像素），从可用空间右侧扣除 */
  rightMargin: number;
  /** 配色模式 */
  colorMode: TaskbarLyricColorMode;
  /** 双行显示（歌词 + 翻译 / 下一行） */
  doubleLine: boolean;
  /** 显示翻译（doubleLine 开启时，副行优先显示翻译，没有翻译则回退到下一行） */
  showTranslation: boolean;
  /** 显示封面 */
  showCover: boolean;
  /** 逐字高亮 */
  wordByWord: boolean;
  /** 字号（逻辑像素） */
  fontSize: number;
  /** 字体 */
  fontFamily: string;
  /** 显示频谱（纯音乐时） */
  showSpectrum: boolean;
  /** 频谱灵敏度（增益倍数，0.5~3.0） */
  spectrumSensitivity: number;
  /** 频谱平滑度（0~1，越大越平滑） */
  spectrumSmoothing: number;
  /** 悬停时显示的频谱条数（0=不收缩） */
  spectrumHoverBarCount: number;
}

/** 音乐库配置 */
export interface LibrarySettings {
  /** 扫描目录列表 */
  scanDirs: string[];
}

/** 流媒体总开关 */
export interface StreamingSettings {
  /** 启用流媒体；关闭后侧边栏隐藏入口 */
  enabled: boolean;
}

/** 外部 API 服务配置 */
export interface ExternalApiSettings {
  /** 总开关 */
  enabled: boolean;
  /** WebSocket 子开关 */
  wsEnabled: boolean;
  /** 允许局域网访问；关闭时仅监听 127.0.0.1 */
  allowLan: boolean;
  /** 监听端口 */
  port: number;
}

/** 外部 API 服务运行时状态 */
export interface ExternalApiStatus {
  /** 是否正在监听 */
  listening: boolean;
  /** 实际生效的局域网开关（监听时绑定的模式，与配置项比对判断是否待重启） */
  allowLan: boolean;
  /** 展示用主机地址：仅本机时为 127.0.0.1，开放局域网时为本机局域网 IP */
  host: string | null;
  /** 实际监听端口 */
  port: number | null;
  /** 上次启动失败的错误 */
  error: { code: string; message: string } | null;
}

/** 一起听进度同步模式 */
export type ListenTogetherProgressMode = "manual" | "interval" | "songOnly";

/** 一起听队列同步模式 */
export type ListenTogetherQueueMode = "currentOnly" | "currentAndNext" | "fullQueue";

/** 一起听配置 */
export interface ListenTogetherSettings {
  /** 总开关；关闭后侧边栏隐藏入口 */
  enabled: boolean;
  /** 监听端口（主机模式时绑定） */
  port: number;
  /** 进度同步模式：manual=仅手动 seek 时同步，interval=周期广播，songOnly=只同步歌曲不同步进度 */
  progressMode: ListenTogetherProgressMode;
  /** 进度同步周期（毫秒，仅 progressMode=interval 时生效） */
  progressInterval: number;
  /** 队列同步模式：currentOnly=仅当前曲，currentAndNext=当前+下一首，fullQueue=完整队列 */
  queueMode: ListenTogetherQueueMode;
  /** 客户端断线自动重连 */
  autoReconnect: boolean;
  /** 上次连接的主机地址（用于快速重连，不含口令） */
  lastHostUrl: string;
}

/** 一起听会话角色 */
export type ListenTogetherRole = "idle" | "host" | "client";

/** 一起听会话成员信息 */
export interface ListenTogetherMember {
  /** 连接 id（主机端唯一） */
  id: string;
  /** 显示名称 */
  name: string;
  /** 网易云级别 */
  level: "default" | "vip" | "svip";
  /** 单向延迟（毫秒，RTT/2） */
  latency: number;
}

/** 一起听运行时状态 */
export interface ListenTogetherStatus {
  /** 当前角色 */
  role: ListenTogetherRole;
  /** 主机模式：监听地址 */
  hostAddress: string | null;
  /** 主机模式：监听端口 */
  hostPort: number | null;
  /** 主机模式：会话口令已设置（不返回口令本身） */
  hasPassword: boolean;
  /** 主机模式：已连接成员列表 */
  members: ListenTogetherMember[];
  /** 客户端模式：连接的主机 URL */
  clientUrl: string | null;
  /** 客户端模式：主机名称 */
  hostName: string | null;
  /** 客户端模式：单向延迟（毫秒） */
  latency: number;
  /** 客户端模式：最近一次错误（用于 UI 提示） */
  lastError: string | null;
}

/** 一起听：本地账号信息（查询网易云登录态后获得） */
export interface ListenTogetherLocalUser {
  /** 昵称 */
  name: string;
  /** 级别 */
  level: "default" | "vip";
}

/** 一起听：mDNS 发现的会话条目 */
export interface ListenTogetherDiscoveredSession {
  /** 服务名（主机显示名） */
  name: string;
  /** 主机地址（优先 IPv4） */
  host: string;
  /** 端口 */
  port: number;
  /** txt 记录中携带的额外信息 */
  txt: {
    /** 主机级别（default / vip） */
    level: "default" | "vip";
    /** 是否需要口令 */
    hasPassword: boolean;
  };
  /** 最近一次发现时间戳 */
  lastSeen: number;
}

/** 在线歌词服务配置 */
export interface OnlineLyricSettings {
  /** 启用在线 TTML 歌词 */
  enableOnlineTTMLLyric: boolean;
  /** AMLL TTML DB 服务地址，需含 %s 占位符 */
  amllDbServer: string;
}

/** 本地歌词配置 */
export interface LocalLyricSettings {
  /** 启用本地 TTML 歌词库：从指定目录按元信息匹配 .ttml，命中优先于在线源 */
  enableLocalTTMLOverride: boolean;
  /** 本地 TTML 歌词库目录 */
  repoDir: string;
}

/** 歌曲缓存配置 */
export interface SongCacheSettings {
  /** 开关：开启后播放远程歌曲会异步下载落盘，下次播放命中本地 */
  enabled: boolean;
  /** 上限（GB），0 表示不限制；超限按 LRU 淘汰 */
  sizeLimitGb: number;
}

/** 缓存配置 */
export interface CacheSettings {
  /** 自定义缓存目录；null 使用默认 {userData}/app-data/cache */
  dir: string | null;
  /** 歌曲文件级缓存 */
  songCache: SongCacheSettings;
}

/** 下载配置 */
export interface DownloadSettings {
  /** 下载功能总开关；关闭后隐藏应用内所有下载入口，下载设置仍可预先配置 */
  enabled: boolean;
  /** 下载目录；null 使用系统下载目录下的应用子目录 */
  dir: string | null;
  /** 下载音质 */
  quality: PluginQuality;
  /** 模拟播放下载：网易云用播放接口替代下载接口，避免占用每日下载次数 */
  usePlaybackForDownload: boolean;
  /** 文件名模板，支持 {artist} {title} {album}；不含子目录 */
  fileTemplate: string;
  /** 文件智能分类：按规则分子文件夹 */
  folderScheme: DownloadFolderScheme;
  /** 重名处理策略 */
  overwritePolicy: "rename" | "overwrite" | "skip";
  /** 内嵌封面 */
  embedCover: boolean;
  /** 内嵌标题/艺术家/专辑等元信息 */
  embedMeta: boolean;
  /** 内嵌歌词到标签 */
  embedLyric: boolean;
  /** 额外保存同名歌词文件 */
  writeLrc: boolean;
  /** 额外保存完整 TTML */
  saveTtml: boolean;
  /** 保存 / 内嵌的歌词格式 */
  lyricFileFormat: DownloadLyricFormat;
}

/** 主窗口几何 */
export interface MainWindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  maximized: boolean;
}

/** 桌面歌词窗口几何 */
export interface DesktopLyricWindowState {
  width: number;
  height: number;
  x: number | null;
  y: number | null;
  visible: boolean;
}

/** 灵动岛窗口几何 */
export interface DynamicIslandWindowState {
  /** snapped: 吸附到屏幕顶部；floating: 自由位置 */
  mode: "snapped" | "floating";
  /** floating: 窗口左上角 x；snapped + 非居中: 窗口中心点 x（让宽度变化时围绕中心对称伸缩） */
  x: number | null;
  /** floating: 窗口左上角 y；snapped + 非居中: 当时所在屏 workArea.y（用于找回所在屏） */
  y: number | null;
  visible: boolean;
}

/** 任务栏歌词窗口状态 */
export interface TaskbarLyricWindowState {
  visible: boolean;
}

/** 窗口几何状态 */
export interface WindowStates {
  main: MainWindowState;
  desktopLyric: DesktopLyricWindowState;
  dynamicIsland: DynamicIslandWindowState;
  taskbarLyric: TaskbarLyricWindowState;
}

/** 应用更新配置 */
export interface AppUpdateSettings {
  /** 自动检查更新 */
  autoCheck: boolean;
}

/** 网易云听歌打卡上报方式 */
export type NeteaseScrobbleMode = "legacy" | "ncbl";

/** 后端配置汇总 */
export interface SystemConfig {
  /** 播放器配置 */
  player: PlayerSettings;
  /** 媒体集成配置 */
  media: MediaSettings;
  /** 音乐库配置 */
  library: LibrarySettings;
  /** 桌面歌词配置 */
  desktopLyric: DesktopLyricSettings;
  /** 灵动岛歌词配置 */
  dynamicIsland: DynamicIslandSettings;
  /** 任务栏歌词配置（仅 Windows） */
  taskbarLyric: TaskbarLyricSettings;
  /** 在线歌词服务配置 */
  lyric: OnlineLyricSettings;
  /** 本地歌词配置 */
  localLyric: LocalLyricSettings;
  /** 缓存配置 */
  cache: CacheSettings;
  /** 下载配置 */
  download: DownloadSettings;
  /** 流媒体总开关 */
  streaming: StreamingSettings;
  /** Last.fm 集成配置 */
  lastfm: LastfmSettings;
  /** 外部 API 服务（HTTP + WS） */
  externalApi: ExternalApiSettings;
  /** 一起听（局域网/公网同步播放） */
  listenTogether: ListenTogetherSettings;
  /** 应用更新配置 */
  update: AppUpdateSettings;
  /** 系统配置 */
  system: {
    /** 记忆窗口状态 */
    rememberWindowState: boolean;
    /** 在任务栏显示播放进度 */
    taskbarProgress: boolean;
    /** 界面缩放百分比（50-200，默认 100） */
    uiZoom: number;
    /** 首启引导是否已完成 */
    onboardingCompleted: boolean;
    /** NCM请求注入国内 IP（X-Real-IP/X-Forwarded-For） */
    neteaseRealIp: boolean;
    /** 听歌打卡开关 */
    neteaseScrobbleEnabled: boolean;
    /** 听歌打卡上报方式 */
    neteaseScrobbleMode: NeteaseScrobbleMode;
    /** 注册为 Orpheus 协议处理程序，抢占网页端「用客户端打开」 */
    registerOrpheusProtocol: boolean;
  };
  /** 窗口几何状态（运行时自动记录，非用户主动配置） */
  windowStates: WindowStates;
  /** 插件系统配置 */
  plugins: PluginsConfig;
  /** 快捷键配置（独立于其他配置，由 hotkey 模块独占） */
  hotkeys: HotkeyConfig;
}

/** 配置 API */
export interface ConfigApi {
  /** 获取单个配置项（点号路径，如 "player.fadeDuration"） */
  get: (keyPath: string) => Promise<unknown>;
  /** 写入单个配置项 */
  set: (keyPath: string, value: unknown) => Promise<void>;
  /** 获取全部配置 */
  getAll: () => Promise<SystemConfig>;
  /** 重置为默认值 */
  reset: () => Promise<void>;
  /** 整盘替换主进程配置 */
  replaceAll: (config: unknown) => Promise<void>;
  /** 写入用户选择的备份文件 */
  exportToFile: (payload: unknown) => Promise<{ ok: boolean; reason?: "canceled" | "writeFailed" }>;
  /** 读取用户选择的备份文件 */
  importFromFile: () => Promise<
    { ok: true; data: unknown } | { ok: false; reason: "canceled" | "readFailed" | "parseFailed" }
  >;
}
