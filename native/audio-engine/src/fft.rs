use parking_lot::Mutex;
use rustfft::{num_complex::Complex, Fft, FftPlanner};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};

/// 每次 FFT 的样本数
const FFT_SIZE: usize = 2048;
/// 输出频段数
const OUTPUT_BINS: usize = 128;
/// 分析频率范围
/// 下限 80Hz 避开直流与低频噪声；上限 16000Hz 覆盖音乐高频泛音
/// 此前为 2000Hz，导致前端按 80~12000Hz 映射时高频段永远为 0
const MIN_FREQ: f32 = 80.0;
const MAX_FREQ: f32 = 16000.0;
/// 环形缓冲区最大样本数
const MAX_BUFFER_SIZE: usize = 8192;

/// 等响度补偿曲线锚点：20Hz 处增益 1.0（基准），20kHz 处增益 12.0（高频补偿峰值）
/// 中间频率在对数域上线性插值，模拟 BetterLyrics 的视觉强化曲线
const LOUDNESS_GAIN_LOW: f32 = 1.0;
const LOUDNESS_GAIN_HIGH: f32 = 12.0;
const LOUDNESS_FREQ_LOW: f32 = 20.0;
const LOUDNESS_FREQ_HIGH: f32 = 20000.0;

/// 全局等响度补偿开关，默认开启
static EQUAL_LOUDNESS_ENABLED: AtomicBool = AtomicBool::new(true);

/// 预计算的等响度补偿增益表，按 OUTPUT_BINS 索引
static LOUDNESS_GAINS: OnceLock<Vec<f32>> = OnceLock::new();

/// 构建等响度补偿增益表，按 bin 中心频率对数插值
fn build_loudness_gains() -> Vec<f32> {
    let log_min = MIN_FREQ.ln();
    let log_max = MAX_FREQ.ln();
    let log_lo = LOUDNESS_FREQ_LOW.ln();
    let log_hi = LOUDNESS_FREQ_HIGH.ln();
    (0..OUTPUT_BINS)
        .map(|i| {
            let t = (i as f32 + 0.5) / OUTPUT_BINS as f32;
            let freq = (log_min + (log_max - log_min) * t).exp();
            if freq <= LOUDNESS_FREQ_LOW {
                LOUDNESS_GAIN_LOW
            } else if freq >= LOUDNESS_FREQ_HIGH {
                LOUDNESS_GAIN_HIGH
            } else {
                let ratio = (freq.ln() - log_lo) / (log_hi - log_lo);
                LOUDNESS_GAIN_LOW + (LOUDNESS_GAIN_HIGH - LOUDNESS_GAIN_LOW) * ratio
            }
        })
        .collect()
}

/// 取等响度补偿增益表（首次调用时构建，后续零开销）
fn loudness_gains() -> &'static [f32] {
    LOUDNESS_GAINS
        .get_or_init(build_loudness_gains)
        .as_slice()
}

/// 设置等响度补偿开关（前端按用户偏好下发，默认开启）
pub fn set_equal_loudness_enabled(enabled: bool) {
    EQUAL_LOUDNESS_ENABLED.store(enabled, Ordering::Relaxed);
}

/// 取等响度补偿开关状态
pub fn is_equal_loudness_enabled() -> bool {
    EQUAL_LOUDNESS_ENABLED.load(Ordering::Relaxed)
}

/// FFT 频谱分析器，接收单声道样本并输出频谱数据
pub struct FftAnalyzer {
    /// 单声道 f32 样本环形缓冲区（由播放线程写入）
    sample_buffer: Mutex<Vec<f32>>,
    /// FFT 输入采样率
    sample_rate: u32,
    /// 缓存的 FFT 计划（避免每次分析时重建）
    fft_plan: Arc<dyn Fft<f32>>,
    /// 预分配的 FFT 工作缓冲区（避免每次 analyze 分配）
    work: Mutex<FftWorkBuffers>,
}

/// 预分配的 FFT 工作缓冲区
struct FftWorkBuffers {
    windowed: Vec<Complex<f32>>,
    output: Vec<f32>,
}

impl FftAnalyzer {
    pub fn new(sample_rate: u32) -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let fft_plan = planner.plan_fft_forward(FFT_SIZE);

        Self {
            sample_buffer: Mutex::new(Vec::with_capacity(MAX_BUFFER_SIZE)),
            sample_rate,
            fft_plan,
            work: Mutex::new(FftWorkBuffers {
                windowed: vec![Complex::new(0.0, 0.0); FFT_SIZE],
                output: vec![0.0; OUTPUT_BINS],
            }),
        }
    }

    /// 推入解码后的单声道样本（由播放线程调用）
    pub fn push_samples(&self, samples: &[f32]) {
        let mut buf = self.sample_buffer.lock();
        buf.extend_from_slice(samples);
        // 只保留最新的样本
        if buf.len() > MAX_BUFFER_SIZE {
            let drain_count = buf.len() - MAX_BUFFER_SIZE;
            buf.drain(..drain_count);
        }
    }

    /// 计算频谱，返回 OUTPUT_BINS 个值，范围 [0.0, 1.0]
    pub fn analyze(&self) -> Vec<f32> {
        let buf = self.sample_buffer.lock();
        if buf.len() < FFT_SIZE {
            return vec![0.0; OUTPUT_BINS];
        }

        // 取最新的 FFT_SIZE 个样本
        let start = buf.len() - FFT_SIZE;
        let samples = &buf[start..];

        let mut work = self.work.lock();

        // 应用 Hamming 窗（复用预分配的 windowed 缓冲区）
        for (i, (&s, w)) in samples.iter().zip(work.windowed.iter_mut()).enumerate() {
            let ham = 0.54
                - 0.46 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE as f32 - 1.0)).cos();
            *w = Complex::new(s * ham, 0.0);
        }

        // 释放 sample_buffer 锁（后续计算不需要它）
        drop(buf);

        // 执行 FFT（使用缓存的计划，原地处理）
        self.fft_plan.process(&mut work.windowed);

        // 将频率段映射到输出频段
        let freq_per_bin = self.sample_rate as f32 / FFT_SIZE as f32;
        let min_bin = (MIN_FREQ / freq_per_bin).floor() as usize;
        let max_bin = ((MAX_FREQ / freq_per_bin).ceil() as usize).min(FFT_SIZE / 2);

        if min_bin >= max_bin {
            work.output.iter_mut().for_each(|v| *v = 0.0);
            return work.output.clone();
        }

        // 使用对数间距分配输出频段
        let log_min = MIN_FREQ.ln();
        let log_max = MAX_FREQ.ln();

        // 等响度补偿表只在开启时取，关闭时返回空切片跳过乘法
        let gains = if is_equal_loudness_enabled() {
            loudness_gains()
        } else {
            &[]
        };

        for i in 0..OUTPUT_BINS {
            let freq_lo = (log_min + (log_max - log_min) * i as f32 / OUTPUT_BINS as f32).exp();
            let freq_hi =
                (log_min + (log_max - log_min) * (i + 1) as f32 / OUTPUT_BINS as f32).exp();

            let bin_lo = ((freq_lo / freq_per_bin).floor() as usize).max(min_bin);
            let bin_hi = ((freq_hi / freq_per_bin).ceil() as usize).min(max_bin);

            if bin_lo >= bin_hi {
                work.output[i] = 0.0;
                continue;
            }

            // 取该范围内的平均幅度（直接从 windowed 的前半部分计算，跳过 magnitudes 中间 Vec）
            let mut sum: f32 = 0.0;
            for j in bin_lo..bin_hi {
                sum += work.windowed[j].norm() / FFT_SIZE as f32;
            }
            let avg = sum / (bin_hi - bin_lo) as f32;

            // 等响度补偿：按 bin 中心频率乘增益（BetterLyrics 风格）
            // 在 dB 转换前应用，避免归一化后乘 12 直接 clip 到 1.0 失去动态范围
            let compensated = if !gains.is_empty() {
                avg * gains[i]
            } else {
                avg
            };

            // 转为 dB 并归一化到 [0, 1]
            let db = 20.0 * (compensated + 1e-10).log10();
            work.output[i] = ((db + 60.0) / 60.0).clamp(0.0, 1.0);
        }

        work.output.clone()
    }

    /// 重置样本缓冲区（例如 seek 时）
    pub fn reset(&self) {
        let mut buf = self.sample_buffer.lock();
        buf.clear();
        buf.shrink_to(MAX_BUFFER_SIZE);
    }
}
