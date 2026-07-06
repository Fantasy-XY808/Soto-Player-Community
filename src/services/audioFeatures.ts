/**
 * 音频特征提取服务
 *
 * 从 native FFT 帧中提取低频脉冲、能量等特征，
 * 供流体背景脉动、频谱呼吸等视觉效果使用。
 *
 * 与参考项目 SPlayer-Next-dev 的 audioFeatures.ts 对齐，
 * 提供更精确的低频脉冲提取（加权 RMS + 峰值混合 + 非对称 EMA）
 */

const FFT_BINS = 128;
const BASS_MIN_FREQ = 80;
const BASS_MAX_FREQ = 180;
const BASS_THRESHOLD = 0.08;
const BASS_GAIN = 2.8;
const BASS_CURVE = 1.05;
const BASS_PEAK_MIX = 0.45;
const BASS_HIGH_BIN_WEIGHT = 0.65;

const AMLL_VOLUME_BASE = 0.5;
const AMLL_VOLUME_RANGE = 9.5;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const FFT_MIN_FREQ = 80;
const FFT_MAX_FREQ = 2000;

const logMin = Math.log(FFT_MIN_FREQ);
const logMax = Math.log(FFT_MAX_FREQ);

const getFftBinEdges = (index: number): { lo: number; hi: number } => {
  const lo = Math.exp(logMin + ((logMax - logMin) * index) / FFT_BINS);
  const hi = Math.exp(logMin + ((logMax - logMin) * (index + 1)) / FFT_BINS);
  return { lo, hi };
};

export const getFftBinRange = (
  minFreq: number,
  maxFreq: number,
): { start: number; end: number } => {
  let start = FFT_BINS;
  let end = 0;

  for (let i = 0; i < FFT_BINS; i++) {
    const { lo, hi } = getFftBinEdges(i);
    if (hi <= minFreq || lo >= maxFreq) continue;
    start = Math.min(start, i);
    end = Math.max(end, i + 1);
  }

  if (start >= end) return { start: 0, end: 0 };
  return { start, end };
};

const bassRange = getFftBinRange(BASS_MIN_FREQ, BASS_MAX_FREQ);

/**
 * 从 native FFT 帧中提取低频脉冲强度
 * 使用加权 RMS + 峰值混合，比简单均值更能反映低频冲击感
 * @param data - 128 段对数频谱
 * @returns 低频脉冲强度，范围 0..1
 */
export const getBassPulse = (data: readonly number[]): number => {
  if (data.length === 0 || bassRange.start >= bassRange.end) return 0;

  let sum = 0;
  let peak = 0;
  let weightSum = 0;
  const count = bassRange.end - bassRange.start;

  for (let i = bassRange.start; i < bassRange.end; i++) {
    const position = count <= 1 ? 0 : (i - bassRange.start) / (count - 1);
    const weight = 1 - position * (1 - BASS_HIGH_BIN_WEIGHT);
    const value = data[i] ?? 0;
    sum += value * value * weight;
    peak = Math.max(peak, value);
    weightSum += weight;
  }

  const rms = Math.sqrt(sum / Math.max(1, weightSum));
  const energy = rms * (1 - BASS_PEAK_MIX) + peak * BASS_PEAK_MIX;
  const normalized = Math.max(0, (energy - BASS_THRESHOLD) / (1 - BASS_THRESHOLD));

  return clamp01(Math.pow(normalized, BASS_CURVE) * BASS_GAIN);
};

/**
 * 将低频脉冲映射为 AMLL 背景渲染器需要的低频音量
 * @param pulse - 低频脉冲强度，范围 0..1
 * @returns AMLL 低频音量
 */
export const toAmllLowFreqVolume = (pulse: number): number =>
  AMLL_VOLUME_BASE + clamp01(pulse) * AMLL_VOLUME_RANGE;

/**
 * 计算全频段能量（用于频谱整体亮度/呼吸）
 * @param data - 128 段对数频谱
 * @returns 归一化能量 0..1
 */
export const getOverallEnergy = (data: readonly number[]): number => {
  if (data.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += (data[i] ?? 0) ** 2;
  }
  return clamp01(Math.sqrt(sum / data.length));
};