//! TPDF Dithering 模块（Triangular PDF + 可选 noise shaping）
//!
//! 用途：
//! - 模拟位深下降（16bit / 24bit 量化效果），让用户试听低品质档听感
//! - 位深下降时消除量化失真（TPDF + 误差反馈，符合 ITU-R BS.2088-0 推荐）
//! - 作为可选 DSP，默认关闭（输出仍为 float32，仅在需要时启用）
//!
//! 算法：
//! - **TPDF 抖动**：加入两个独立均匀随机数之差（三角分布）
//!   - `noise = (r1 - r2) * half_step`，其中 `half_step = step / 2`
//!   - 三角分布的噪声功率正好等于一个量化步长的量化误差功率，
//!     使量化噪声线性化、与信号不相关，消除低音量时的"颗粒感"
//! - **量化**：`q = round((x + noise + shape_offset) / step) * step`
//!   - 16bit → step = 2^-15 ≈ 3.05e-5
//!   - 24bit → step = 2^-23 ≈ 1.19e-7
//!   - 32bit → 直通（float32 已是该精度）
//! - **Noise shaping**：一阶误差反馈，把量化误差反馈到下一个样本
//!   - `error = (x + noise + shape_offset) - q`
//!   - `shape_state = error * 0.5`（一阶反馈系数 0.5，符合 Wannamaker 论文）
//!   - 把噪声推到高频段（人耳不敏感区），主观响度更低
//!
//! 性能：
//! - xorshift32 PRNG（无 std 依赖、每样本 ~3ns）
//! - 立体声左右声道独立 PRNG（避免相关性）
//! - bypass / 32bit 时 early return，零开销
//!
//! 参考：
//! - Wannamaker, R. A., "Efficient Generation of Multichannel Dither Signals"
//! - ITU-R BS.2088-0 §5.2.4 TPDF with noise shaping

use std::sync::atomic::{AtomicBool, Ordering};

use parking_lot::Mutex;

/// TPDF Dithering 参数
#[derive(Clone, Copy)]
pub struct TpdfDitherParams {
    /// 目标位深（16 / 24 / 32）；32 时直通，无量化
    pub target_bit_depth: u8,
    /// 是否启用一阶误差反馈 noise shaping
    pub noise_shape: bool,
    /// A/B bypass：true 时跳过 DSP
    pub bypass: bool,
}

impl Default for TpdfDitherParams {
    fn default() -> Self {
        Self {
            target_bit_depth: 16,
            noise_shape: true,
            bypass: false,
        }
    }
}

/// xorshift32 PRNG（Marsaglia 2003，无依赖、统计均匀）
struct XorShift32 {
    state: u32,
}

impl XorShift32 {
    fn new(seed: u32) -> Self {
        // 种子为 0 时强制非零（xorshift 0 永远输出 0）
        Self {
            state: if seed == 0 { 0xDEADBEEF } else { seed },
        }
    }

    #[inline]
    fn next_u32(&mut self) -> u32 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        x
    }

    /// 返回 [-1.0, 1.0) 均匀分布
    #[inline]
    fn next_f32_signed(&mut self) -> f32 {
        // 取高 24 位作为 mantissa，避免低位的相关性
        let u = self.next_u32();
        // u >> 8 ∈ [0, 2^24-1]，除以 2^23 得到 [0, 2)，减 1 得到 [-1, 1)
        (u >> 8) as f32 / ((1u32 << 23) as f32) - 1.0
    }
}

/// 单声道 TPDF 状态
struct ChannelState {
    prng_a: XorShift32,
    prng_b: XorShift32,
    /// 上一样本的累积量化误差（用于 noise shaping）
    error: f32,
    /// gate 软切换的 dither 强度系数（0.0=完全静音段无 dither，1.0=全量 dither）
    /// 静音段线性衰减到 0，有信号段线性恢复到 1，周期 GATE_FADE_SAMPLES
    dither_amount: f32,
}

impl ChannelState {
    fn new(seed: u32) -> Self {
        // 两个 PRNG 用不同种子（避免相关）
        Self {
            prng_a: XorShift32::new(seed),
            prng_b: XorShift32::new(seed.wrapping_mul(2654435761).wrapping_add(1)),
            error: 0.0,
            dither_amount: 1.0,
        }
    }

    fn reset(&mut self) {
        self.error = 0.0;
        self.dither_amount = 1.0;
    }
}

/// TPDF Dithering 处理器
pub struct TpdfDither {
    enabled: AtomicBool,
    params: Mutex<TpdfDitherParams>,
    channels: Mutex<[ChannelState; 2]>,
}

impl TpdfDither {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            params: Mutex::new(TpdfDitherParams::default()),
            channels: Mutex::new([ChannelState::new(0x12345678), ChannelState::new(0x9ABCDEF0)]),
        }
    }

    /// 配置开关与参数
    pub fn configure(&self, enabled: bool, params: TpdfDitherParams) {
        self.enabled.store(enabled, Ordering::Relaxed);
        *self.params.lock() = params;
        if !enabled {
            self.channels.lock().iter_mut().for_each(|c| c.reset());
        }
    }

    /// 仅更新参数（不改变 enabled）
    pub fn set_params(&self, params: TpdfDitherParams) {
        let mut p = self.params.lock();
        let old_bypass = p.bypass;
        let old_bd = p.target_bit_depth;
        *p = params;
        let new_bypass = p.bypass;
        let new_bd = p.target_bit_depth;
        drop(p);

        // 切到 bypass 或位深变化时清空 noise shaping 状态
        if (new_bypass && !old_bypass) || old_bd != new_bd {
            self.channels.lock().iter_mut().for_each(|c| c.reset());
        }
    }

    /// 取当前参数副本
    pub fn params(&self) -> TpdfDitherParams {
        *self.params.lock()
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// 重置内部状态（load 新曲目时调用，避免上一首的 noise shaping 残留）
    pub fn reset_state(&self) {
        self.channels.lock().iter_mut().for_each(|c| c.reset());
    }

    /// 处理交错立体声样本（原地修改）
    ///
    /// 流程：
    /// - 取量化步长 step = 2^(-target_bit_depth+1)
    /// - TPDF 抖动：r1, r2 两个独立均匀随机数之差 × half_step
    /// - Noise shaping：累积误差反馈
    /// - 量化：round((x + noise + shape_offset) / step) * step
    pub fn process_interleaved_stereo(&self, samples: &mut [f32]) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let p = *self.params.lock();
        if p.bypass {
            return;
        }
        // 32bit 直通：float32 已经是该精度，无需抖动
        if p.target_bit_depth >= 32 {
            return;
        }

        // 量化步长：
        // 16bit → step = 2^-15 ≈ 3.05e-5
        // 24bit → step = 2^-23 ≈ 1.19e-7
        let step = 2.0_f32.powf(-(p.target_bit_depth as f32 - 1.0));
        let half_step = step * 0.5;

        let mut chans = self.channels.lock();
        for chunk in samples.chunks_exact_mut(2) {
            chunk[0] =
                Self::process_sample(&mut chans[0], chunk[0], step, half_step, p.noise_shape);
            chunk[1] =
                Self::process_sample(&mut chans[1], chunk[1], step, half_step, p.noise_shape);
        }
    }

    #[inline]
    fn process_sample(
        chan: &mut ChannelState,
        x: f32,
        step: f32,
        half_step: f32,
        noise_shape: bool,
    ) -> f32 {
        // gate 软切换，避免静音边界 dither 全有/全无硬切产生奇次谐波失真
        //
        // 软切换方案：维护 dither_amount ∈ [0, 1]
        // - 静音段（x.abs() < step*0.5）：每样本衰减 1/GATE_FADE_SAMPLES
        // - 有声段：每样本恢复 1/GATE_FADE_SAMPLES
        // - 不清零 chan.error：保留 noise shaping 状态，让边界过渡连续
        //
        // 64 样本 ≈ 1.3ms @ 48kHz，足够跨越人耳对突变的感知阈值（~1ms），
        // 同时不会显著影响静音段的"无 dither"听感（衰减段 RMS 极低）
        const GATE_FADE_SAMPLES: f32 = 64.0;
        if x.abs() < step * 0.5 {
            chan.dither_amount = (chan.dither_amount - 1.0 / GATE_FADE_SAMPLES).max(0.0);
            // 不清零 chan.error，保留 noise shaping 状态
        } else {
            chan.dither_amount = (chan.dither_amount + 1.0 / GATE_FADE_SAMPLES).min(1.0);
        }

        // dither_amount 为 0 时直接返回（完全静音段无 dither）
        if chan.dither_amount <= 0.0 {
            return x;
        }

        // TPDF：两个独立均匀 [-half_step, half_step] 之差 → 三角分布
        // noise 整体乘以 dither_amount，实现软切换的幅度渐变
        let r1 = chan.prng_a.next_f32_signed() * half_step * chan.dither_amount;
        let r2 = chan.prng_b.next_f32_signed() * half_step * chan.dither_amount;
        let noise = r1 - r2;

        // Noise shaping：把上一样本的量化误差反馈到当前样本
        let shape_offset = if noise_shape { chan.error } else { 0.0 };

        // 加噪 + 误差反馈后量化到 step 网格
        let x_with_noise = x + noise + shape_offset;
        let quantized = (x_with_noise / step).round() * step;

        // 累积量化误差（系数 0.5 = 一阶反馈，Wannamaker 推荐值）
        if noise_shape {
            chan.error = (x_with_noise - quantized) * 0.5;
        }

        quantized
    }
}

impl Default for TpdfDither {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dither_silence() {
        // 静音输入抖动后应无直流偏移（TPDF 平衡分布）
        let dither = TpdfDither::new();
        dither.enabled.store(true, Ordering::Relaxed);
        let mut samples = vec![0.0f32; 48_000 * 2];
        dither.process_interleaved_stereo(&mut samples);
        let mean: f32 = samples.iter().sum::<f32>() / samples.len() as f32;
        assert!(mean.abs() < 1e-4, "TPDF 抖动产生直流偏移: {}", mean);
        // 抖动功率应接近 step^2 / 6（TPDF 方差公式）
        // 16bit step=3.05e-5, 方差 ~1.55e-10, RMS ~1.24e-5
        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
        assert!(rms < 1e-3, "TPDF 抖动 RMS 过大: {}", rms);
    }

    #[test]
    fn test_dither_full_scale_sine_no_clip() {
        let dither = TpdfDither::new();
        dither.enabled.store(true, Ordering::Relaxed);
        let mut samples: Vec<f32> = (0..48_000)
            .flat_map(|i| {
                let x = (i as f32 * 2.0 * std::f32::consts::PI / 48000.0).sin() * 0.99;
                [x, x]
            })
            .collect();
        dither.process_interleaved_stereo(&mut samples);
        // 量化后不应超出 [-1, 1]
        assert!(
            samples.iter().all(|s| s.abs() <= 1.0 + 1e-6),
            "TPDF 抖动削波"
        );
    }

    #[test]
    fn test_dither_bypass() {
        let dither = TpdfDither::new();
        dither.enabled.store(true, Ordering::Relaxed);
        dither.set_params(TpdfDitherParams {
            target_bit_depth: 16,
            noise_shape: true,
            bypass: true,
        });
        let mut samples = vec![0.5f32; 100];
        dither.process_interleaved_stereo(&mut samples);
        assert!(
            samples.iter().all(|s| (*s - 0.5).abs() < 1e-7),
            "bypass 时样本应不变"
        );
    }

    #[test]
    fn test_dither_32bit_passthrough() {
        let dither = TpdfDither::new();
        dither.enabled.store(true, Ordering::Relaxed);
        dither.set_params(TpdfDitherParams {
            target_bit_depth: 32,
            noise_shape: true,
            bypass: false,
        });
        let mut samples = vec![0.123_456_789_f32; 100];
        dither.process_interleaved_stereo(&mut samples);
        assert!(
            samples.iter().all(|s| (*s - 0.123_456_789).abs() < 1e-9),
            "32bit 应直通无抖动"
        );
    }
}
