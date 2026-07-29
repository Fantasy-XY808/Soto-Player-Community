/**
 * RGB 神光同步效果算法
 *
 * 5 种效果模式（spectrum / beat / color / gradient / vu）的纯函数实现。
 * 除 computeBeat 需要跨帧状态外，其余均为无副作用纯函数。
 *
 * FFT 数据约定：长度 64 的 Float32Array 或 number[]，值域 0-1。
 * 颜色值域：RGB 三通道 0-255 整数。
 */

import type { RgbColor, RgbDeviceConfig } from "@shared/types/rgbSync";

/** 节拍模式跨帧状态（需由调用方按 deviceId 维护） */
export interface BeatState {
  /** 上一帧低频能量（用于峰值检测的上升沿判定） */
  lastEnergy: number;
  /** 上次触发时间戳（ms），用于 200ms 防抖 */
  lastTriggerTime: number;
  /** 当前闪烁强度 0-1（触发瞬间=1，按 beatDecay 指数衰减到 0） */
  currentIntensity: number;
}

/** 创建初始节拍状态 */
export const createBeatState = (): BeatState => ({
  lastEnergy: 0,
  lastTriggerTime: 0,
  currentIntensity: 0,
});

/** 将值钳制到 0-255 并四舍五入为整数 */
const clampChannel = (v: number): number => {
  const rounded = Math.round(v);
  if (rounded < 0) return 0;
  if (rounded > 255) return 255;
  return rounded;
};

/**
 * HSL → RGB 转换
 * @param h 色相 0-360（超出会自动取模）
 * @param s 饱和度 0-1
 * @param l 亮度 0-1
 * @returns RgbColor（0-255）
 */
export const hslToRgb = (h: number, s: number, l: number): RgbColor => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  const m = l - c / 2;
  return {
    r: clampChannel((r1 + m) * 255),
    g: clampChannel((g1 + m) * 255),
    b: clampChannel((b1 + m) * 255),
  };
};

/**
 * 两色线性插值
 * @param a 起点颜色
 * @param b 终点颜色
 * @param t 插值因子 0-1（自动钳制）
 */
export const lerpColor = (a: RgbColor, b: RgbColor, t: number): RgbColor => {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    r: clampChannel(a.r + (b.r - a.r) * clamped),
    g: clampChannel(a.g + (b.g - a.g) * clamped),
    b: clampChannel(a.b + (b.b - a.b) * clamped),
  };
};

/**
 * 亮度乘数（用于按能量/全局亮度缩放颜色）
 * @param color 原始颜色
 * @param factor 乘数（0=黑，1=原色，>1=增亮，自动钳制到 0-255）
 */
export const scaleColor = (color: RgbColor, factor: number): RgbColor => ({
  r: clampChannel(color.r * factor),
  g: clampChannel(color.g * factor),
  b: clampChannel(color.b * factor),
});

/**
 * HEX 字符串（#RRGGBB）转 RgbColor
 * @param hex HEX 字符串，可为 null（封面色未提取时）
 * @returns RgbColor；解析失败返回中灰 {128,128,128}
 */
export const hexToRgbColor = (hex: string | null | undefined): RgbColor => {
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex)) return { r: 128, g: 128, b: 128 };
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
};

/** 取颜色来源：custom 时用 customColor，否则用 coverColor */
const resolveBaseColor = (config: RgbDeviceConfig, coverColor: RgbColor): RgbColor =>
  config.colorSource === "custom" ? config.customColor : coverColor;

/**
 * 把 0-1 的能量值映射为亮度乘数
 * gamma=0.7 让中段能量更可见（线性映射时低能量几乎全黑）
 */
const energyToScale = (energy: number): number => {
  const e = Math.max(0, Math.min(1, energy));
  return Math.pow(e, 0.7);
};

/**
 * 频谱模式：FFT 分桶映射到 LED
 *
 * 将 FFT 按 spectrumBuckets 分桶求平均，每桶能量映射到对应 LED 的亮度。
 * ledCount 与 spectrumBuckets 不等时通过线性插值平滑过渡。
 *
 * @param fft FFT 频谱数据（0-1）
 * @param ledCount 设备 LED 数量
 * @param config 设备配置
 * @param coverColor 封面提取色（colorSource="cover" 时作为基色）
 * @returns 长度 = ledCount 的颜色数组
 */
export const computeSpectrum = (
  fft: Float32Array | readonly number[],
  ledCount: number,
  config: RgbDeviceConfig,
  coverColor: RgbColor,
): RgbColor[] => {
  if (ledCount <= 0) return [];
  const baseColor = resolveBaseColor(config, coverColor);
  const buckets = Math.max(2, config.spectrumBuckets);

  // FFT 分桶求平均
  const n = fft.length;
  const bucketValues: number[] = new Array(buckets);
  if (n === 0) {
    for (let i = 0; i < buckets; i++) bucketValues[i] = 0;
  } else {
    const per = n / buckets;
    for (let i = 0; i < buckets; i++) {
      const start = Math.floor(i * per);
      const end = Math.floor((i + 1) * per);
      let sum = 0;
      let cnt = 0;
      for (let j = start; j < end; j++) {
        sum += fft[j] ?? 0;
        cnt++;
      }
      bucketValues[i] = cnt > 0 ? sum / cnt : 0;
    }
  }

  // 按 LED 索引线性插值取桶值，方向由 spectrumDirection 决定
  const colors: RgbColor[] = new Array(ledCount);
  for (let i = 0; i < ledCount; i++) {
    const t = ledCount > 1 ? i / (ledCount - 1) : 0;
    let bucketIdx: number;
    if (config.spectrumDirection === "leftToRight") {
      // 桶 0 → LED 0，桶 N-1 → LED N-1
      bucketIdx = t * (buckets - 1);
    } else if (config.spectrumDirection === "centerOut") {
      // 桶 0 → 中心 LED，桶 N-1 → 两端 LED（V 形）
      bucketIdx = Math.abs(2 * t - 1) * (buckets - 1);
    } else {
      // mirror：桶 0 → 两端 LED，桶 N-1 → 中心 LED（Λ 形）
      bucketIdx = (1 - Math.abs(2 * t - 1)) * (buckets - 1);
    }
    const low = Math.floor(bucketIdx);
    const high = Math.min(buckets - 1, low + 1);
    const frac = bucketIdx - low;
    const v = bucketValues[low] * (1 - frac) + bucketValues[high] * frac;
    colors[i] = scaleColor(baseColor, energyToScale(v));
  }
  return colors;
};

/**
 * 节拍模式：能量阈值检测，触发后全设备闪烁并衰减
 *
 * 计算 FFT 低频段（前 1/8）平均能量，超过阈值且距上次触发 > 200ms 时触发。
 * 触发瞬间所有 LED = beatColor 满亮度，未触发时按 beatDecay 指数衰减到黑。
 *
 * @param fft FFT 频谱数据（0-1）
 * @param ledCount 设备 LED 数量
 * @param config 设备配置
 * @param _coverColor 封面色（保留参数位以与其他效果对齐，节拍模式使用 beatColor）
 * @param state 跨帧状态（会被原地修改）
 * @param now 当前时间戳（ms），默认 Date.now()
 * @returns { colors, state } —— colors 长度 = ledCount，state 为更新后的状态
 */
export const computeBeat = (
  fft: Float32Array | readonly number[],
  ledCount: number,
  config: RgbDeviceConfig,
  _coverColor: RgbColor,
  state: BeatState,
  now: number = Date.now(),
): { colors: RgbColor[]; state: BeatState } => {
  if (ledCount <= 0) return { colors: [], state };

  // 低频段（前 1/8）平均能量
  const lowEnd = Math.max(1, Math.floor(fft.length / 8));
  let sum = 0;
  for (let i = 0; i < lowEnd; i++) sum += fft[i] ?? 0;
  const energy = sum / lowEnd;

  // 灵敏度 0-100 → 阈值 0.6-0.05（灵敏度越高阈值越低）
  const threshold = 0.6 - (config.beatSensitivity / 100) * 0.55;

  // 触发条件：能量超阈值 + 比上一帧上升 10% + 距上次触发 > 200ms
  const isBeat =
    energy > threshold &&
    energy > state.lastEnergy * 1.1 &&
    now - state.lastTriggerTime > 200;

  let intensity: number;
  if (isBeat) {
    intensity = 1;
    state.lastTriggerTime = now;
  } else {
    // 指数衰减：beatDecay=0 → 不衰减；beatDecay=100 → 每帧衰减 30%
    const decayFactor = 1 - (config.beatDecay / 100) * 0.3;
    intensity = state.currentIntensity * decayFactor;
    if (intensity < 0.01) intensity = 0;
  }

  state.lastEnergy = energy;
  state.currentIntensity = intensity;

  const color = scaleColor(config.beatColor, intensity);
  return { colors: new Array(ledCount).fill(color), state };
};

/**
 * 静态颜色模式：所有 LED 统一颜色
 *
 * @param ledCount 设备 LED 数量
 * @param config 设备配置
 * @param coverColor 封面提取色（colorSource="cover" 时使用）
 * @returns 长度 = ledCount 的颜色数组
 */
export const computeColor = (
  ledCount: number,
  config: RgbDeviceConfig,
  coverColor: RgbColor,
): RgbColor[] => {
  const color = resolveBaseColor(config, coverColor);
  return new Array(ledCount).fill(color);
};

/**
 * 渐变流动模式：时间驱动的 HSL 渐变
 *
 * 若 config.gradientColors 至少 2 色，用线性插值在颜色间渐变；
 * 否则用 HSL 全色环渐变（每个 LED hue 偏移 120° 覆盖全色环）。
 *
 * @param ledCount 设备 LED 数量
 * @param config 设备配置
 * @param time 当前时间戳（ms），通常传 Date.now()
 * @returns 长度 = ledCount 的颜色数组
 */
export const computeGradient = (
  ledCount: number,
  config: RgbDeviceConfig,
  time: number,
): RgbColor[] => {
  if (ledCount <= 0) return [];
  // speed=0 → 10s 周期；speed=100 → 1s 周期
  const periodMs = Math.max(100, 10000 - config.gradientSpeed * 90);
  const phase = (time / periodMs) % 1;

  if (config.gradientColors && config.gradientColors.length >= 2) {
    const palette = config.gradientColors;
    const n = palette.length;
    const colors: RgbColor[] = new Array(ledCount);
    for (let i = 0; i < ledCount; i++) {
      // LED 索引归一化 + 时间相位 → 在调色板上的浮动位置
      const t = ledCount > 1 ? i / (ledCount - 1) : 0;
      const flow = (t + phase) % 1;
      const pos = flow * (n - 1);
      const low = Math.floor(pos);
      const high = Math.min(n - 1, low + 1);
      const frac = pos - low;
      colors[i] = lerpColor(palette[low], palette[high], frac);
    }
    return colors;
  }

  // 默认 HSL 渐变：baseHue 随时间推进，每个 LED hue 偏移 (i/ledCount) * 120
  const baseHue = phase * 360;
  const colors: RgbColor[] = new Array(ledCount);
  for (let i = 0; i < ledCount; i++) {
    const offset = ledCount > 1 ? (i / (ledCount - 1)) * 120 : 0;
    colors[i] = hslToRgb((baseHue + offset) % 360, 1, 0.5);
  }
  return colors;
};

/**
 * 音量计模式：RMS 能量映射点亮 LED 数量
 *
 * 计算 FFT 所有频段 RMS 平均能量，按能量比例点亮 LED。
 * 底部 LED = vuColorLow，顶部 LED = vuColorHigh，渐变过渡。
 *
 * @param fft FFT 频谱数据（0-1）
 * @param ledCount 设备 LED 数量
 * @param config 设备配置
 * @returns 长度 = ledCount 的颜色数组
 */
export const computeVu = (
  fft: Float32Array | readonly number[],
  ledCount: number,
  config: RgbDeviceConfig,
): RgbColor[] => {
  if (ledCount <= 0) return [];
  let sum = 0;
  for (let i = 0; i < fft.length; i++) {
    const v = fft[i] ?? 0;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, fft.length));
  const energy = Math.max(0, Math.min(1, rms));

  const colors: RgbColor[] = new Array(ledCount);
  const centerIdx = (ledCount - 1) / 2;
  // centerOut 时从中心向两侧点亮的半径（LED 数）
  const litRadius = (energy * ledCount) / 2;

  for (let i = 0; i < ledCount; i++) {
    // pos：颜色在 low→high 渐变中的位置 0-1（0=最底/中心，1=最顶/边缘）
    let pos: number;
    let isLit: boolean;
    if (config.vuDirection === "bottomUp") {
      pos = ledCount > 1 ? i / (ledCount - 1) : 0;
      isLit = i < energy * ledCount;
    } else {
      const distFromCenter = Math.abs(i - centerIdx);
      pos = ledCount > 1 ? distFromCenter / centerIdx : 0;
      isLit = distFromCenter < litRadius;
    }
    colors[i] = isLit
      ? lerpColor(config.vuColorLow, config.vuColorHigh, pos)
      : { r: 0, g: 0, b: 0 };
  }
  return colors;
};
