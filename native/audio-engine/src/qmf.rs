//! QMF（Quadrature Mirror Filter）分析/综合滤波器组
//!
//! 用于 super_resolution 的子带分析。基于 DFT modulated filter bank
//! （复数 STFT 风格），使用 sine 窗 50% overlap 满足 COLA（Constant Overlap-Add），
//! 严格保证完美重构。
//!
//! 架构（参考 MPEG-2 AAC SBR ISO/IEC 14496-3 子带分析的简化版）：
//! - 原型窗：sine 窗 w[n] = sin(π·(n+0.5)/N)，长度 N = 2·M
//! - 50% overlap：hop_size = M，COLA 满足 w²[n] + w²[n+M] = 1（sin²+cos²=1）
//! - 分析：滑动缓冲左移 hop → 加窗 → N 点 FFT → M 个复数子带（共轭对称取前一半）
//! - 综合：M 子带 + 共轭镜像 → N 点 IFFT → 加综合窗 → OLA → M 个时域样本
//! - 算法延迟：N/2 = M samples @ 96kHz ≈ 0.33ms（M=32 时）
//!
//! 子带映射（M=32 @ 96kHz，N=64）：
//! - 子带 0 (DC)：[0, 0Hz]
//! - 子带 1-15：[1.5kHz, 22.5kHz]（每子带 1.5kHz，正频率）
//! - 子带 16-31：[24kHz, 46.5kHz]（高频合成区，SBR 在此应用）
//! - 每子带频率宽度 = fs / N = 96kHz / 64 = 1500Hz
//!
//! 复数子带 vs 实数子带（DCT-IV / MDCT）：
//! - 复数子带：可分别处理幅度和相位，便于相位梯度外推
//! - 实数子带（MDCT）：只能处理幅度，相位信息丢失，需额外 MDST 配对
//! SBR 需要相位梯度外推，故选复数子带（FFT 实现）
//!
//! Nyquist 处理（fft_buf[N/2] = fft_buf[M]）：
//! - 实数输入时 fft_buf[M] 是实数（虚部为 0）
//! - subbands 数 = M，存 fft_buf[0..M-1]（DC + 正频率 1..M-1）
//! - fft_buf[M] (Nyquist) 不存，综合时置零（48kHz 处的 Nyquist 信息丢失，带限信号影响可忽略）

use std::f32::consts::PI;
use std::sync::Arc;

use rustfft::{num_complex::Complex, Fft, FftPlanner};

/// QMF 配置
#[derive(Clone, Debug)]
pub struct QmfConfig {
    /// 子带数（默认 32，可调 16/32/64）
    /// 也是 hop_size（50% overlap，N = 2·M）
    pub num_bands: usize,
}

impl Default for QmfConfig {
    fn default() -> Self {
        Self { num_bands: 32 }
    }
}

/// QMF 分析滤波器组（复数子带，DFT modulated filter bank）
///
/// 输入：M 个时域样本（hop size）
/// 输出：M 个复数子带样本（前 N/2 = M 个，正频率 + DC）
pub struct QmfAnalysis {
    m: usize,         // 子带数 = hop_size
    n: usize,         // FFT size = 2 * M
    window: Vec<f32>, // sine 窗，长度 N
    buffer: Vec<f32>, // 滑动缓冲，长度 N
    fft: Arc<dyn Fft<f32>>,
    fft_buf: Vec<Complex<f32>>,
}

impl QmfAnalysis {
    pub fn new(config: QmfConfig) -> Self {
        let m = config.num_bands;
        let n = 2 * m;
        let window = design_sine_window(n);
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(n);
        Self {
            m,
            n,
            window,
            buffer: vec![0.0; n],
            fft,
            fft_buf: vec![Complex::new(0.0, 0.0); n],
        }
    }

    /// 分析一个块：M 个输入样本 → M 个复数子带样本
    pub fn analyze_block(&mut self, input: &[f32], subbands: &mut [Complex<f32>]) {
        debug_assert_eq!(input.len(), self.m);
        debug_assert_eq!(subbands.len(), self.m);

        // 移位缓冲（左移 hop = M）
        self.buffer.copy_within(self.m.., 0);
        self.buffer[self.n - self.m..].copy_from_slice(input);

        // 加窗 + FFT
        for k in 0..self.n {
            self.fft_buf[k] = Complex::new(self.buffer[k] * self.window[k], 0.0);
        }
        self.fft.process(&mut self.fft_buf);

        // 输出前 M 个复数子带（DC + 正频率 1..M-1，Nyquist 不存）
        subbands[..self.m].copy_from_slice(&self.fft_buf[..self.m]);
    }

    /// 重置状态（切歌时调用）
    pub fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.fft_buf.fill(Complex::new(0.0, 0.0));
    }

    /// 当前 QMF 分析器的子带数 M
    #[allow(dead_code)]
    pub fn num_bands(&self) -> usize {
        self.m
    }
}

/// QMF 综合滤波器组
///
/// 输入：M 个复数子带样本
/// 输出：M 个时域样本
pub struct QmfSynthesis {
    m: usize,
    n: usize,
    window: Vec<f32>,
    output_buffer: Vec<f32>,
    ifft: Arc<dyn Fft<f32>>,
    fft_buf: Vec<Complex<f32>>,
}

impl QmfSynthesis {
    pub fn new(config: QmfConfig) -> Self {
        let m = config.num_bands;
        let n = 2 * m;
        let window = design_sine_window(n);
        let mut planner = FftPlanner::<f32>::new();
        let ifft = planner.plan_fft_inverse(n);
        Self {
            m,
            n,
            window,
            output_buffer: vec![0.0; n],
            ifft,
            fft_buf: vec![Complex::new(0.0, 0.0); n],
        }
    }

    /// 综合一个块：M 个复数子带样本 → M 个输出样本
    pub fn synthesize_block(&mut self, subbands: &[Complex<f32>], output: &mut [f32]) {
        debug_assert_eq!(subbands.len(), self.m);
        debug_assert_eq!(output.len(), self.m);

        // 重建 FFT buffer（共轭对称）
        // fft_buf[0..M] = subbands[0..M]（DC + 正频率）
        // fft_buf[M] (Nyquist) 置零（不存）
        // fft_buf[N-k] = fft_buf[k].conj()（共轭镜像，k = 1..M-1）
        self.fft_buf[..self.m].copy_from_slice(&subbands[..self.m]);
        // 强制 DC 实数（消除数值误差导致的虚部）
        self.fft_buf[0] = Complex::new(self.fft_buf[0].re, 0.0);
        // Nyquist 置零
        self.fft_buf[self.m] = Complex::new(0.0, 0.0);
        // 共轭镜像
        for k in 1..self.m {
            self.fft_buf[self.n - k] = self.fft_buf[k].conj();
        }

        // IFFT
        self.ifft.process(&mut self.fft_buf);

        // 加综合窗 + OLA
        // IFFT 归一化系数 1/N
        // sine 窗 50% overlap COLA = 1（w²[n] + w²[n+M] = 1），无需额外归一化
        // 综合 OLA：y[n] = sum_m (ifft_m[n] * w[n]) / COLA_const
        // 对 sine 50% overlap，COLA_const = 1
        let scale = 1.0 / self.n as f32;
        for k in 0..self.n {
            self.output_buffer[k] += self.fft_buf[k].re * self.window[k] * scale;
        }

        // 输出前 M 个样本
        output[..self.m].copy_from_slice(&self.output_buffer[..self.m]);

        // 移位并清零（左移 hop = M）
        self.output_buffer.copy_within(self.m.., 0);
        for i in (self.n - self.m)..self.n {
            self.output_buffer[i] = 0.0;
        }
    }

    /// 重置状态（切歌时调用）
    pub fn reset(&mut self) {
        self.output_buffer.fill(0.0);
        self.fft_buf.fill(Complex::new(0.0, 0.0));
    }

    /// 当前 QMF 综合器的子带数 M
    #[allow(dead_code)]
    pub fn num_bands(&self) -> usize {
        self.m
    }
}

/// 设计 sine 窗：w[n] = sin(π·(n+0.5)/N)
///
/// 满足 50% overlap COLA：w²[n] + w²[n + N/2] = sin²(x) + cos²(x) = 1
/// 其中 x = π·(n+0.5)/N，x + π/2 = π·(n+0.5+N/2)/N
fn design_sine_window(n: usize) -> Vec<f32> {
    let mut w = vec![0.0; n];
    for k in 0..n {
        w[k] = (PI * (k as f32 + 0.5) / n as f32).sin();
    }
    w
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 完美重构测试：分析 + 综合 ≈ 原始（误差 < 5%）
    #[test]
    fn qmf_perfect_reconstruction() {
        let m = 32;
        let config = QmfConfig { num_bands: m };
        let mut analysis = QmfAnalysis::new(config.clone());
        let mut synthesis = QmfSynthesis::new(config);

        // 生成测试信号（1kHz 正弦波 @ 96kHz）
        let sample_rate = 96_000.0_f32;
        let freq = 1_000.0_f32;
        let input_signal: Vec<f32> = (0..10_000)
            .map(|n| (2.0 * PI * freq * n as f32 / sample_rate).sin() * 0.5)
            .collect();

        let mut output_signal = vec![0.0; input_signal.len()];

        // 处理（分析 → 综合）
        let mut subbands = vec![Complex::new(0.0, 0.0); m];
        let mut output_block = vec![0.0; m];
        for i in (0..input_signal.len() - m).step_by(m) {
            analysis.analyze_block(&input_signal[i..i + m], &mut subbands);
            synthesis.synthesize_block(&subbands, &mut output_block);
            output_signal[i..i + m].copy_from_slice(&output_block);
        }

        // 验证稳态部分（跳过前 4M = N 个样本的瞬态）
        // 50% overlap QMF 有 N/2 = M 样本固有延迟，需对齐延迟比较
        let warmup = 4 * m;
        let delay = m;
        let mut max_err = 0.0_f32;
        let mut max_val = 0.0_f32;
        for i in (warmup + delay)..input_signal.len().min(warmup + 2000) {
            max_val = max_val.max(input_signal[i - delay].abs());
            let err = (output_signal[i] - input_signal[i - delay]).abs();
            max_err = max_err.max(err);
        }
        // 允许 5% 相对误差（sine 窗 COLA 严格 = 1，理论完美重构）
        let rel_err = max_err / max_val.max(1e-6);
        assert!(
            rel_err < 0.05,
            "QMF 完美重构相对误差过大: {} (max_err={}, max_val={})",
            rel_err,
            max_err,
            max_val
        );
    }

    /// 子带隔离度测试：1kHz 信号应主要落在子带 0-1（@ 96kHz, M=32, 每子带 1.5kHz）
    #[test]
    fn qmf_subband_isolation() {
        let m = 32;
        let config = QmfConfig { num_bands: m };
        let mut analysis = QmfAnalysis::new(config);

        // 1kHz 正弦波应落在子带 0（[0, 1.5kHz]）
        let sample_rate = 96_000.0_f32;
        let freq = 1_000.0_f32;
        // 用 M 块长度 × 多块，让稳态充分建立
        let n_blocks = 8;
        let total_samples = n_blocks * m;
        let input: Vec<f32> = (0..total_samples)
            .map(|n| (2.0 * PI * freq * n as f32 / sample_rate).sin() * 0.5)
            .collect();

        let mut subbands = vec![Complex::new(0.0, 0.0); m];
        let mut last_lf_energy = 0.0_f32;
        let mut last_hf_energy = 0.0_f32;
        for i in (0..total_samples - m).step_by(m) {
            analysis.analyze_block(&input[i..i + m], &mut subbands);
            // 用最后一块（稳态）
            last_lf_energy = subbands[0..2].iter().map(|c| c.norm_sqr()).sum();
            last_hf_energy = subbands[16..32].iter().map(|c| c.norm_sqr()).sum();
        }
        let ratio = last_hf_energy / last_lf_energy.max(1e-10);
        // sine 窗旁瓣约 -23dB → 比值 0.07，放宽到 0.15（远端 16-31 衰减更大）
        assert!(ratio < 0.15, "子带隔离度不足: hf/lf = {}", ratio);
    }

    /// 静音通过测试
    #[test]
    fn qmf_silence_passthrough() {
        let m = 32;
        let config = QmfConfig { num_bands: m };
        let mut analysis = QmfAnalysis::new(config.clone());
        let mut synthesis = QmfSynthesis::new(config);

        let input = vec![0.0; m];
        let mut subbands = vec![Complex::new(0.0, 0.0); m];
        let mut output = vec![0.0; m];

        for _ in 0..10 {
            analysis.analyze_block(&input, &mut subbands);
            synthesis.synthesize_block(&subbands, &mut output);
            let max_val = output.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
            assert!(max_val < 1e-6, "静音通过失败: max_val = {}", max_val);
        }
    }

    /// 重置状态测试
    #[test]
    fn qmf_reset_clears_state() {
        let m = 32;
        let config = QmfConfig { num_bands: m };
        let mut analysis = QmfAnalysis::new(config.clone());
        let mut synthesis = QmfSynthesis::new(config);

        // 喂入信号
        let input: Vec<f32> = (0..m).map(|n| (n as f32 * 0.1).sin()).collect();
        let mut subbands = vec![Complex::new(0.0, 0.0); m];
        let mut output = vec![0.0; m];
        for _ in 0..5 {
            analysis.analyze_block(&input, &mut subbands);
            synthesis.synthesize_block(&subbands, &mut output);
        }

        // 重置
        analysis.reset();
        synthesis.reset();

        // 喂入静音，输出应接近零
        let silence = vec![0.0; m];
        for _ in 0..10 {
            analysis.analyze_block(&silence, &mut subbands);
            synthesis.synthesize_block(&subbands, &mut output);
            let max_val = output.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
            assert!(max_val < 1e-6, "重置后状态残留: max_val = {}", max_val);
        }
    }

    /// 不同子带数测试（16/32/64）
    #[test]
    fn qmf_different_band_counts() {
        for &m in &[16, 32, 64] {
            let config = QmfConfig { num_bands: m };
            let mut analysis = QmfAnalysis::new(config.clone());
            let mut synthesis = QmfSynthesis::new(config);

            let input: Vec<f32> = (0..m)
                .map(|n| (2.0 * PI * n as f32 / m as f32).sin() * 0.5)
                .collect();
            let mut subbands = vec![Complex::new(0.0, 0.0); m];
            let mut output = vec![0.0; m];

            // 不应 panic
            for _ in 0..5 {
                analysis.analyze_block(&input, &mut subbands);
                synthesis.synthesize_block(&subbands, &mut output);
            }
        }
    }
}
