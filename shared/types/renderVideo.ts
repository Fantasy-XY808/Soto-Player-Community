/**
 * 视频渲染功能共享类型
 * 跨渲染层（主窗口配置 / 渲染窗口捕获）与主进程（窗口管理 / 文件落盘）
 */

import type { Track } from "./player";
import type { PluginQuality } from "./plugin";
import type { LyricLine } from "./lyrics";

/** 视频容器格式 */
export type RenderVideoFormat = "webm" | "mp4";

/** 视频分辨率预设 */
export type RenderVideoResolution = "720p" | "1080p" | "1440p" | "2160p";

/** 视频帧率 */
export type RenderVideoFps = 24 | 30 | 60;

/** 渲染任务状态 */
export type RenderVideoStatus =
  | "queued"
  | "preparing"
  | "rendering"
  | "muxing"
  | "done"
  | "failed"
  | "canceled";

/** 渲染模式：单首独立文件 / 串接为单个视频 */
export type RenderVideoMode = "single" | "merge";

/** 渲染请求参数（由主窗口配置 Dialog 传给主进程） */
export interface RenderVideoRequest {
  /** 渲染层生成的 UUID */
  taskId: string;
  /** 渲染模式 */
  mode: RenderVideoMode;
  /** 待渲染曲目列表（single 模式仅取首项，merge 模式按顺序串接） */
  tracks: Track[];
  /**
   * 与 tracks 一一对应的音频 URL（已由渲染层解析）
   * - 本地文件：file:// URL
   * - 在线平台：https:// URL（含解灰源 fallback）
   * 主进程不再二次解析，保证与播放/下载使用同一 URL 源
   */
  audioUrls: string[];
  /**
   * 与 tracks 一一对应的已解析歌词行
   * 主窗口通过 lyric IPC 拉取并 parse 后下发，避免主进程依赖渲染层逻辑
   * 空数组表示该曲目无歌词
   */
  parsedLyrics: LyricLine[][];
  /**
   * 用户当前设置快照（locale / appearance / player / lyric / system）
   * 主窗口从 settings store 序列化，渲染窗口启动时 deep-merge
   * 保证"所见即所得"——渲染输出视觉与主播放界面完全一致
   */
  settingsSnapshot: {
    locale?: string;
    appearance?: Record<string, unknown>;
    player?: Record<string, unknown>;
    lyric?: Record<string, unknown>;
    system?: Record<string, unknown>;
  };
  /**
   * 用户当前主题快照（mode / source / customColor / globalTint / appearanceStyle /
   * imageBackground / imageBackgroundColor）
   *
   * 主窗口从 theme store 序列化。渲染窗口使用独立 partition（persist:video-renderer），
   * localStorage 与主窗口隔离，theme store 持久化值在渲染窗口侧为空，必须通过快照下发
   * 才能保证主题色 / 暗色模式 / 液态玻璃 / 图片背景等与主窗口完全一致。
   */
  themeSnapshot: {
    mode?: "light" | "dark" | "system";
    source?: "default" | "custom" | "cover" | "solid";
    customColor?: string;
    globalTint?: boolean;
    appearanceStyle?: "solid" | "image";
    imageBackground?: { src: string; blur: number; dim: number; scale: number };
    imageBackgroundColor?: string | null;
    /** 封面主色（hex），由主窗口 extractColorFromUrl 写入；source="cover" 主题与背景色依赖此值 */
    coverColor?: string | null;
  };
  /** 音质档位（与 PluginQuality 对齐） */
  quality: PluginQuality;
  /** 视频格式 */
  format: RenderVideoFormat;
  /** 分辨率预设 */
  resolution: RenderVideoResolution;
  /** 帧率 */
  fps: RenderVideoFps;
  /** 视频码率（bps），0 表示由编码器自动决定 */
  videoBitrate: number;
  /** 输出目录（主进程校验存在性） */
  outputDir: string;
  /** 是否在串接模式下渲染切歌过渡动画 */
  renderTransition: boolean;
  /** 切歌过渡风格（由渲染层从全局设置读取并下发） */
  trackTransitionStyle: "scale" | "fade" | "slide" | "none";
}

/** 主进程持有的渲染任务 */
export interface RenderVideoTask {
  taskId: string;
  status: RenderVideoStatus;
  mode: RenderVideoMode;
  /** 当前渲染到的曲目索引（merge 模式有效） */
  currentIndex: number;
  /** 总曲目数 */
  total: number;
  /** 当前曲目已渲染时长（毫秒） */
  renderedMs: number;
  /** 当前曲目总时长（毫秒） */
  currentDurationMs: number;
  /** 完成后最终文件路径 */
  filePath?: string;
  /** 失败原因 */
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

/** 渲染进度推送 */
export interface RenderVideoProgress {
  taskId: string;
  status: RenderVideoStatus;
  currentIndex: number;
  total: number;
  renderedMs: number;
  currentDurationMs: number;
}

/** 渲染窗口配置（主进程 → 渲染窗口） */
export interface RenderWindowConfig {
  taskId: string;
  /** 已解析的音频 URL（file:// 或 https://），与主播放器完全独立 */
  audioUrl: string;
  /** 曲目信息 */
  track: Track;
  /** 视频格式 */
  format: RenderVideoFormat;
  /** 分辨率（宽高） */
  width: number;
  height: number;
  /** 帧率 */
  fps: RenderVideoFps;
  /** 视频码率（bps） */
  videoBitrate: number;
  /** 是否为 merge 模式且非首项（需播放入点过渡） */
  isContinuation: boolean;
  /** 切歌过渡风格（从全局设置读取，渲染窗口需复用） */
  trackTransitionStyle: "scale" | "fade" | "slide" | "none";
  /** 输出文件名（不含扩展名，主进程已校验路径） */
  outputName: string;
  /**
   * 已解析的歌词行数据
   * 主进程通过 lyric IPC 拉取并 parse 后下发，渲染窗口无需重复解析
   * 空数组表示无歌词（封面居中或显示「暂无歌词」占位）
   */
  lyricLines: LyricLine[];
  /**
   * 用户设置快照（locale / appearance / player / lyric / system 五大段）
   * 主进程通过 store.getAll() 拉取 electron-store 持久化值
   * 渲染窗口启动时 deep-merge 到 settings store，保证"所见即所得"
   */
  settingsSnapshot: {
    locale?: string;
    appearance?: Record<string, unknown>;
    player?: Record<string, unknown>;
    lyric?: Record<string, unknown>;
    system?: Record<string, unknown>;
  };
  /**
   * 用户主题快照（mode / source / customColor / globalTint / appearanceStyle /
   * imageBackground / imageBackgroundColor）
   *
   * 主窗口在 RenderVideoDialog 序列化 theme store 字段后下发，渲染窗口 applySnapshot
   * 到本地 theme store 后触发 apply() 重写 CSS 变量与 data-* 属性，保证主题色 / 暗色
   * 模式 / 液态玻璃 / 图片背景等与主窗口完全一致。
   */
  themeSnapshot: {
    mode?: "light" | "dark" | "system";
    source?: "default" | "custom" | "cover" | "solid";
    customColor?: string;
    globalTint?: boolean;
    appearanceStyle?: "solid" | "image";
    imageBackground?: { src: string; blur: number; dim: number; scale: number };
    imageBackgroundColor?: string | null;
    /** 封面主色（hex），由主窗口 extractColorFromUrl 写入；source="cover" 主题与背景色依赖此值 */
    coverColor?: string | null;
  };
}

/** 渲染端 → 主进程的捕获分片 */
export interface RenderVideoChunk {
  taskId: string;
  /** 分片索引 */
  index: number;
  /** 是否为最后一帧 */
  final: boolean;
  /** webm/mp4 分片数据 */
  data: ArrayBuffer;
}

/** 渲染端 → 主进程的状态事件 */
export type RenderVideoEvent =
  | { type: "started"; taskId: string; durationMs: number }
  | { type: "progress"; taskId: string; renderedMs: number }
  | { type: "frame"; taskId: string; renderedMs: number }
  | { type: "finished"; taskId: string; filePath: string }
  | { type: "error"; taskId: string; message: string }
  | { type: "canceled"; taskId: string };

/** 渲染端 IPC 入口 */
export interface RenderVideoApi {
  /** 启动渲染任务（主窗口 → 主进程） */
  start: (req: RenderVideoRequest) => Promise<{ ok: boolean; error?: string }>;
  /** 取消渲染任务 */
  cancel: (taskId: string) => Promise<void>;
  /** 获取当前任务列表 */
  list: () => Promise<RenderVideoTask[]>;
  /** 选择输出目录 */
  pickDir: () => Promise<{ ok: boolean; dir: string; reason?: "canceled" }>;
  /** 获取输出目录 */
  getDir: () => Promise<string>;
  /** 设置输出目录 */
  setDir: (dir: string) => Promise<void>;
  /** 订阅进度更新 */
  onProgress: (callback: (data: RenderVideoProgress) => void) => () => void;
  /** 订阅状态变更 */
  onState: (callback: (task: RenderVideoTask) => void) => () => void;
  /** 订阅任务完成（带文件路径） */
  onFinished: (callback: (data: { taskId: string; filePath: string }) => void) => () => void;
  /** 订阅任务失败 */
  onFailed: (callback: (data: { taskId: string; error: string }) => void) => () => void;
  /** 发送分片（渲染窗口专用） */
  sendChunk: (taskId: string, data: ArrayBuffer, final: boolean) => void;
  /** 发送进度更新 */
  sendProgress: (taskId: string, renderedMs: number) => void;
  /** 通知当前曲目完成 */
  sendFinished: (taskId: string) => void;
  /** 通知错误 */
  sendError: (taskId: string, message: string) => void;
  /** 订阅主进程下发的渲染配置 */
  onConfig: (callback: (data: RenderWindowConfig) => void) => () => void;
  /** 订阅取消指令 */
  onCancel: (callback: (data: { taskId: string }) => void) => () => void;
  /** 渲染窗口通知主进程已就绪（onConfig/onCancel 已订阅） */
  sendReady: () => void;
  /**
   * 请求主进程捕获当前渲染窗口画面
   *
   * 主进程调用 webContents.capturePage() 取得 NativeImage，
   * 转换为 PNG data URL 后返回。渲染窗口拿到 data URL 后：
   * 1. 创建 Image 对象加载
   * 2. drawImage 到隐藏 canvas
   * 3. canvas.captureStream(fps) 自动捕获为新帧
   *
   * 用于"完整复用 FullPlayer 视觉"——把 FullPlayer 的真实 DOM 渲染
   * 通过逐帧截图喂给 MediaRecorder，保证所见即所得。
   *
   * @returns PNG data URL（base64）；失败时返回空字符串
   */
  captureFrame: () => Promise<string>;
}
