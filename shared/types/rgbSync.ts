/**
 * RGB 神光同步类型定义
 *
 * 通过 OpenRGB SDK 控制键盘背光、机箱 RGB 等设备，
 * 实现音乐驱动的灯光效果。
 */

/** RGB 效果模式 */
export type RgbEffectType = "spectrum" | "beat" | "color" | "gradient" | "vu";

/** 颜色来源 */
export type RgbColorSource = "cover" | "custom";

/** 频谱方向 */
export type RgbSpectrumDirection = "leftToRight" | "centerOut" | "mirror";

/** 音量计方向 */
export type RgbVuDirection = "bottomUp" | "centerOut";

/** RGB 颜色（0-255） */
export interface RgbColor {
  /** 红 0-255 */
  r: number;
  /** 绿 0-255 */
  g: number;
  /** 蓝 0-255 */
  b: number;
}

/** 单设备配置 */
export interface RgbDeviceConfig {
  /** 是否启用该设备 */
  enabled: boolean;
  /** 效果模式 */
  effect: RgbEffectType;
  /** 颜色来源：封面提取 or 自定义 */
  colorSource: RgbColorSource;
  /** 自定义颜色（colorSource="custom" 时生效） */
  customColor: RgbColor;
  /** 频谱模式：分桶数（2-32，决定频谱分辨率） */
  spectrumBuckets: number;
  /** 频谱模式：LED 映射方向 */
  spectrumDirection: RgbSpectrumDirection;
  /** 节拍模式：灵敏度（0-100，越高越容易触发） */
  beatSensitivity: number;
  /** 节拍模式：闪烁颜色 */
  beatColor: RgbColor;
  /** 节拍模式：衰减速度（0-100，越高闪烁消失越快） */
  beatDecay: number;
  /** 渐变模式：流动速度（0-100） */
  gradientSpeed: number;
  /** 渐变模式：渐变色列表（至少 2 色） */
  gradientColors: RgbColor[];
  /** 音量计模式：低能量颜色 */
  vuColorLow: RgbColor;
  /** 音量计模式：高能量颜色 */
  vuColorHigh: RgbColor;
  /** 音量计模式：LED 映射方向 */
  vuDirection: RgbVuDirection;
}

/** RGB 同步设置 */
export interface RgbSyncSettings {
  /** 总开关 */
  enabled: boolean;
  /** OpenRGB 服务地址（默认 localhost） */
  host: string;
  /** OpenRGB 服务端口（默认 6742） */
  port: number;
  /** 推送帧率（10-60，默认 30） */
  fps: number;
  /** 全局亮度（0-100，作为所有颜色的乘数） */
  brightness: number;
  /** 设备配置映射（key = deviceId） */
  devices: Record<number, RgbDeviceConfig>;
}

/** OpenRGB 设备信息（渲染层可见子集） */
export interface RgbDeviceInfo {
  /** 设备 ID（OpenRGB 分配） */
  id: number;
  /** 设备类型（OpenRGB DeviceType 枚举） */
  type: number;
  /** 设备名称 */
  name: string;
  /** 设备描述 */
  description: string;
  /** LED 数量 */
  ledCount: number;
  /** 区域列表 */
  zones: Array<{ name: string; ledCount: number }>;
  /** 支持的模式列表 */
  modes: Array<{ id: number; name: string }>;
}

/** OpenRGB 连接状态 */
export interface RgbSyncStatus {
  /** 是否已连接 */
  connected: boolean;
  /** 设备列表 */
  devices: RgbDeviceInfo[];
  /** 错误信息（连接失败时） */
  error?: string;
}

/** 一帧颜色数据（IPC 传输用） */
export interface RgbFrameData {
  /** 设备 ID */
  deviceId: number;
  /** 该设备所有 LED 的颜色数组 */
  colors: RgbColor[];
}
