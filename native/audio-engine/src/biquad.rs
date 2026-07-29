//! 通用 Biquad 滤波器（RBJ Audio EQ Cookbook 实现）
//!
//! 本模块提供 Direct Form II Transposed 结构的 Biquad 滤波器，
//! 支持项目当前需要的 RBJ Cookbook 滤波器类型（highpass / lowpass / lowshelf）。
//!
//! ## 设计目的
//!
//! 早期项目中 `BiquadState` 在 `super_resolution.rs` 和 `bass_enhancer.rs` 中
//! 各有一份重复定义。本模块统一了该实现，避免代码重复和维护不一致。
//!
//! ## 使用方
//!
//! - `bass_enhancer`：低频提取（lowshelf）+ 谐波整形（lowpass）
//! - `dpl2_upmix`：环绕通道低通 + LFE 低通
//! - `neural_upsample`：包络检测（lowpass）+ 谐波提取（highpass）
//!
//! ## 算法说明
//!
//! - 结构：Direct Form II Transposed（数值稳定性优于 DF1/DF2）
//! - 系数：按 RBJ Cookbook 公式生成（参考 https://www.musicdsp.org/en/latest/Filters/197-rjb-cookbook.html）
//! - 精度：f32（音频实时处理足够，母带级可后续升级为 f64）

use std::f32::consts::PI;

/// 单声道 Biquad 状态（Direct Form II Transposed）
///
/// 系数 (b0, b1, b2, a1, a2) 由 `configure_*` 方法设置，
/// 状态 (z1, z2) 在 `process` 调用间保持，实现 IIR 滤波。
#[derive(Clone, Copy, Default)]
pub struct BiquadState {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl BiquadState {
    /// 创建直通滤波器（输出 = 输入）
    pub fn passthrough() -> Self {
        Self {
            b0: 1.0,
            ..Default::default()
        }
    }

    /// 按 RBJ Cookbook 配置高通滤波器系数
    pub fn configure_highpass(&mut self, freq: f32, sample_rate: f32, q: f32) {
        let omega = 2.0 * PI * freq / sample_rate;
        let cos_omega = omega.cos();
        let sin_omega = omega.sin();
        let alpha = sin_omega / (2.0 * q);

        let b0 = (1.0 + cos_omega) / 2.0;
        let b1 = -(1.0 + cos_omega);
        let b2 = (1.0 + cos_omega) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_omega;
        let a2 = 1.0 - alpha;

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
    }

    /// 按 RBJ Cookbook 配置低通滤波器系数
    pub fn configure_lowpass(&mut self, freq: f32, sample_rate: f32, q: f32) {
        let omega = 2.0 * PI * freq / sample_rate;
        let cos_omega = omega.cos();
        let sin_omega = omega.sin();
        let alpha = sin_omega / (2.0 * q);

        let b0 = (1.0 - cos_omega) / 2.0;
        let b1 = 1.0 - cos_omega;
        let b2 = (1.0 - cos_omega) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_omega;
        let a2 = 1.0 - alpha;

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
    }

    /// 按 RBJ Cookbook 配置 low-shelf 滤波器系数
    pub fn configure_lowshelf(&mut self, freq: f32, sample_rate: f32, gain_db: f32, q: f32) {
        let omega = 2.0 * PI * freq / sample_rate;
        let cos_omega = omega.cos();
        let sin_omega = omega.sin();
        let alpha = sin_omega / (2.0 * q);
        let a = 10.0_f32.powf(gain_db / 40.0);
        let sqrt_a = a.sqrt();

        let b0 = a * ((a + 1.0) - (a - 1.0) * cos_omega + 2.0 * sqrt_a * alpha);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_omega);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos_omega - 2.0 * sqrt_a * alpha);
        let a0 = (a + 1.0) + (a - 1.0) * cos_omega + 2.0 * sqrt_a * alpha;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_omega);
        let a2 = (a + 1.0) + (a - 1.0) * cos_omega - 2.0 * sqrt_a * alpha;

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
    }

    /// 处理单个样本（Direct Form II Transposed）
    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    /// 重置内部状态（切歌时调用）
    pub fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 直通滤波器应原样输出
    #[test]
    fn passthrough_returns_input() {
        let mut bp = BiquadState::passthrough();
        for x in [-0.5, 0.0, 0.5, 1.0, -1.0] {
            assert!((bp.process(x) - x).abs() < 1e-6);
        }
    }

    /// 低通滤波器应衰减高频
    #[test]
    fn lowpass_attenuates_high_frequency() {
        let mut lp = BiquadState::passthrough();
        lp.configure_lowpass(1000.0, 48_000.0, 0.7071);
        // 预热：丢弃前 1000 个样本（让滤波器瞬态衰减）
        for n in 0..1000 {
            lp.process((2.0 * PI * 100.0 * n as f32 / 48_000.0).sin());
        }
        // 测量阶段：12kHz 高频 vs 100Hz 低频
        let mut energy_hf = 0.0_f32;
        let mut energy_lf = 0.0_f32;
        // 测高频（重新预热）
        lp.reset();
        lp.configure_lowpass(1000.0, 48_000.0, 0.7071);
        for _ in 0..500 {
            lp.process(0.0);
        }
        for n in 0..4800 {
            let x_hf = (2.0 * PI * 12_000.0 * n as f32 / 48_000.0).sin() * 0.5;
            energy_hf += lp.process(x_hf).powi(2);
        }
        // 测低频（重新预热）
        lp.reset();
        lp.configure_lowpass(1000.0, 48_000.0, 0.7071);
        for _ in 0..500 {
            lp.process(0.0);
        }
        for n in 0..4800 {
            let x_lf = (2.0 * PI * 100.0 * n as f32 / 48_000.0).sin() * 0.5;
            energy_lf += lp.process(x_lf).powi(2);
        }
        // 低频能量应远大于高频能量（1kHz 低通对 12kHz 衰减约 -24dB ≈ 1/16）
        assert!(
            energy_lf > energy_hf * 8.0,
            "低频能量 {} 应大于高频能量 {} 的 8 倍",
            energy_lf,
            energy_hf
        );
    }

    /// 高通滤波器应衰减低频
    #[test]
    fn highpass_attenuates_low_frequency() {
        let mut hp = BiquadState::passthrough();
        hp.configure_highpass(5000.0, 48_000.0, 0.7);
        // 预热
        for _ in 0..500 {
            hp.process(0.0);
        }
        // 测高频：12kHz 应通过
        let mut energy_hf = 0.0_f32;
        for n in 0..4800 {
            let x_hf = (2.0 * PI * 12_000.0 * n as f32 / 48_000.0).sin() * 0.5;
            energy_hf += hp.process(x_hf).powi(2);
        }
        // 重新预热后测低频：100Hz 应被衰减
        hp.reset();
        hp.configure_highpass(5000.0, 48_000.0, 0.7);
        for _ in 0..500 {
            hp.process(0.0);
        }
        let mut energy_lf = 0.0_f32;
        for n in 0..4800 {
            let x_lf = (2.0 * PI * 100.0 * n as f32 / 48_000.0).sin() * 0.5;
            energy_lf += hp.process(x_lf).powi(2);
        }
        // 高频能量应远大于低频能量（5kHz 高通对 100Hz 衰减严重）
        assert!(
            energy_hf > energy_lf * 3.0,
            "高频能量 {} 应大于低频能量 {} 的 3 倍",
            energy_hf,
            energy_lf
        );
    }

    /// reset 应清空内部状态
    #[test]
    fn reset_clears_state() {
        let mut bp = BiquadState::passthrough();
        bp.configure_lowpass(1000.0, 48_000.0, 0.7);
        // 累积一些状态
        for n in 0..100 {
            bp.process((2.0 * PI * 100.0 * n as f32 / 48_000.0).sin());
        }
        bp.reset();
        // reset 后处理 0 输入，输出应快速收敛到 0
        let mut max_out = 0.0_f32;
        for _ in 0..100 {
            max_out = max_out.max(bp.process(0.0).abs());
        }
        assert!(max_out < 1e-6, "reset 后输出应为 0，实际 {}", max_out);
    }

    /// Biquad 稳定性测试：长时间运行不应发散
    #[test]
    fn biquad_stability_long_run() {
        let mut bp = BiquadState::passthrough();
        bp.configure_lowpass(5000.0, 48_000.0, 0.7);
        let mut max_val = 0.0_f32;
        for i in 0..48_000 {
            let x = (i as f32 * 0.01).sin();
            let y = bp.process(x);
            max_val = max_val.max(y.abs());
        }
        assert!(max_val < 2.0, "biquad 发散: max={max_val}");
    }
}
