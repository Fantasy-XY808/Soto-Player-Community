//! LPC（Linear Predictive Coding）包络外推模块
//!
//! 用于 super_resolution 的高频包络外推。
//! 在 QMF 子带域上，用低频参考区（[0, 12kHz]）的子带能量序列
//! 计算 LPC 系数，然后外推到高频区（[24kHz, 48kHz]）。
//!
//! 算法（参考 MPEG-2 AAC SBR ISO/IEC 14496-3 包络外推）：
//! - 计算低频子带能量序列 x[0..L]
//! - 自相关：r[k] = sum_{n=0}^{L-1-k} x[n] * x[n+k]，k = 0..order
//! - Levinson-Durbin 递归：从 r[0..order+1] 求 LPC 系数 a[1..order]
//! - 包络外推：用 LPC 模型外推高频子带能量
//!   y[n] = -sum_{k=1}^{order} a[k] * y[n-k]，n >= L
//! - 衰减系数：高频包络按 -X dB/oct 衰减（默认 -6 dB/oct，模拟自然高频衰减）
//!
//! 模块无状态：每帧独立计算，无需 reset。

/// PI 常量仅用于单元测试中的正弦波生成
#[cfg(test)]
use std::f32::consts::PI;

/// LPC 配置
#[derive(Clone, Debug)]
pub struct LpcConfig {
    /// LPC 阶数（默认 8，可调 4/8/16/32）
    /// 阶数越高，对包络的建模越精细，但对外推的稳定性也越敏感
    pub order: usize,
    /// 高频衰减系数 dB/oct（默认 -6.0，模拟自然高频衰减）
    /// -6dB/oct = 自然信号衰减，-12dB/oct = 更陡衰减，0dB/oct = 不衰减
    pub decay_db_per_oct: f32,
}

impl Default for LpcConfig {
    fn default() -> Self {
        Self {
            order: 8,
            decay_db_per_oct: -6.0,
        }
    }
}

/// LPC 包络外推器（无状态，每帧独立计算）
pub struct LpcExtrapolator {
    config: LpcConfig,
}

impl LpcExtrapolator {
    pub fn new(config: LpcConfig) -> Self {
        Self { config }
    }

    /// 获取当前 LPC 配置（阶数 / 块长度等）
    #[allow(dead_code)]
    pub fn config(&self) -> &LpcConfig {
        &self.config
    }

    /// 计算自相关序列 r[0..order+1]
    ///
    /// r[k] = sum_{n=0}^{L-1-k} x[n] * x[n+k]
    /// 不归一化（r[0] = 信号能量）
    #[cfg_attr(not(test), allow(dead_code))]
    fn autocorrelate(x: &[f32], order: usize) -> Vec<f32> {
        let n = x.len();
        let mut r = vec![0.0; order + 1];
        for k in 0..=order {
            for i in 0..n.saturating_sub(k) {
                r[k] += x[i] * x[i + k];
            }
        }
        r
    }

    /// 零分配版本的自相关，结果写入预分配 buffer
    ///
    /// 调用方需保证 `r.len() >= order + 1`，函数只写入 `r[0..=order]`，不改变其余部分。
    /// 热路径（super_resolution 每帧调用）使用此版本避免堆分配。
    #[inline]
    fn autocorrelate_into(x: &[f32], order: usize, r: &mut [f32]) {
        let n = x.len();
        for k in 0..=order {
            let mut sum = 0.0_f32;
            for i in 0..n.saturating_sub(k) {
                sum += x[i] * x[i + k];
            }
            r[k] = sum;
        }
    }

    /// Levinson-Durbin 递归：从自相关 r[0..order+1] 求 LPC 系数 a[1..order]
    ///
    /// 算法（经典递推）：
    /// - 初始化：a[0] = 1, e = r[0]
    /// - 对 i = 1..order：
    ///   - 反射系数 k[i] = (r[i] - sum_{j=1}^{i-1} a[j]*r[i-j]) / e
    ///   - a[i] = k[i]
    ///   - 对 j = 1..i-1: a[j] = a_prev[j] - k[i] * a_prev[i-j]
    ///   - e = (1 - k²) * e
    ///
    /// 返回 (lpc[1..order], gain) - LPC 系数（不含 a[0]=1）和预测误差增益 sqrt(e)
    ///
    /// 数值稳定性：调用方应在 autocorrelate 后对 r[0] 加白噪声补偿
    /// （Tikhonov 正则化，r[0] *= 1 + μ，μ = 1e-6），
    /// 保证 |k[i]| < 1，避免低信噪比时滤波器发散
    #[cfg_attr(not(test), allow(dead_code))]
    fn levinson_durbin(r: &[f32], order: usize) -> (Vec<f32>, f32) {
        if r.is_empty() || r[0] < 1e-10 {
            return (vec![0.0; order], 0.0);
        }

        let mut a = vec![0.0; order + 1];
        let mut a_prev = vec![0.0; order + 1];
        let mut e = r[0];
        a[0] = 1.0;

        for i in 1..=order {
            // 反射系数 k[i] = (r[i] - sum_{j=1}^{i-1} a_prev[j]*r[i-j]) / e
            let mut acc = r[i];
            for j in 1..i {
                acc -= a_prev[j] * r[i - j];
            }
            let k = if e.abs() < 1e-10 { 0.0 } else { acc / e };

            // 更新 LPC 系数
            a[i] = k;
            for j in 1..i {
                a[j] = a_prev[j] - k * a_prev[i - j];
            }

            e = (1.0 - k * k) * e;
            if e < 1e-10 {
                e = 1e-10;
                a_prev.copy_from_slice(&a);
                break;
            }
            a_prev.copy_from_slice(&a);
        }

        let lpc = a[1..=order].to_vec();
        (lpc, e.sqrt())
    }

    /// 零分配版本的 Levinson-Durbin，结果写入预分配 buffer
    ///
    /// 调用方需保证：
    /// - `a.len() >= order + 1`
    /// - `a_prev.len() >= order + 1`
    /// 返回 sqrt(e)（预测误差增益）。LPC 系数在 a[1..=order]，a[0] = 1.0。
    #[inline]
    fn levinson_durbin_into(r: &[f32], order: usize, a: &mut [f32], a_prev: &mut [f32]) -> f32 {
        if r.is_empty() || r[0] < 1e-10 {
            for v in a.iter_mut().take(order + 1) {
                *v = 0.0;
            }
            a[0] = 1.0;
            return 0.0;
        }

        // 清零 a 和 a_prev
        for v in a.iter_mut().take(order + 1) {
            *v = 0.0;
        }
        for v in a_prev.iter_mut().take(order + 1) {
            *v = 0.0;
        }

        let mut e = r[0];
        a[0] = 1.0;

        for i in 1..=order {
            // 反射系数 k[i] = (r[i] - sum_{j=1}^{i-1} a_prev[j]*r[i-j]) / e
            let mut acc = r[i];
            for j in 1..i {
                acc -= a_prev[j] * r[i - j];
            }
            let k = if e.abs() < 1e-10 { 0.0 } else { acc / e };

            // 更新 LPC 系数
            a[i] = k;
            for j in 1..i {
                a[j] = a_prev[j] - k * a_prev[i - j];
            }

            e = (1.0 - k * k) * e;
            if e < 1e-10 {
                e = 1e-10;
                a_prev[..=order].copy_from_slice(&a[..=order]);
                break;
            }
            a_prev[..=order].copy_from_slice(&a[..=order]);
        }

        e.sqrt()
    }

    /// 外推：用低频序列 x[0..L] 外推 num_high 个高频样本
    ///
    /// 参数：
    /// - `x`：低频参考序列（如子带 0..M/2 的能量）
    /// - `num_high`：要外推的高频样本数（如子带 M/2..M 的能量）
    /// - `octaves_per_bin`：每个高频 bin 对应的 octaves 数
    ///   （如 M=32 @ 96kHz：高频 16 个子带覆盖 [24kHz, 48kHz]，1 octave = 24kHz，每子带 = 1.5kHz → 1/16 octave/bin）
    ///
    /// 返回：外推后的高频能量序列（长度 = num_high）
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn extrapolate(&self, x: &[f32], num_high: usize, octaves_per_bin: f32) -> Vec<f32> {
        let order = self.config.order;
        if x.len() < order + 1 || num_high == 0 {
            return vec![0.0; num_high];
        }

        // 自相关
        let mut r = Self::autocorrelate(x, order);

        // 白噪声补偿（Tikhonov 正则化）：r[0] *= (1 + μ)
        // 保证 Levinson-Durbin 反射系数 |k[i]| < 1，避免低信噪比时滤波器发散
        // μ = 1e-6 是经验值：足够小不损失精度，足够大保证数值稳定
        const WHITE_NOISE_FACTOR: f32 = 1e-6;
        r[0] *= 1.0 + WHITE_NOISE_FACTOR;

        // Levinson-Durbin 求 LPC 系数
        let (a, _gain) = Self::levinson_durbin(&r, order);

        // 外推：y[n] = -sum_{k=1}^{order} a[k] * y[n-k]
        let mut y = vec![0.0; num_high + order];
        let l = x.len();
        // 初始化：y[0..order] = x 的最后 order 个样本（保持连续性）
        for i in 0..order {
            y[i] = x[l - order + i].max(1e-10);
        }

        for n in order..(num_high + order) {
            let mut pred = 0.0;
            for k in 1..=order {
                pred -= a[k - 1] * y[n - k];
            }
            y[n] = pred.abs().max(1e-10); // 包络为正
        }

        // 衰减：按 -decay_db_per_oct dB/oct 衰减
        let per_bin_decay_db = self.config.decay_db_per_oct * octaves_per_bin;
        let per_bin_decay_lin = 10.0_f32.powf(per_bin_decay_db / 20.0);

        let mut decay = 1.0;
        let mut result = vec![0.0; num_high];
        for i in 0..num_high {
            result[i] = y[order + i] * decay;
            decay *= per_bin_decay_lin;
        }

        result
    }

    /// 零分配版本的 extrapolate，结果写入预分配 buffer
    ///
    /// 调用方需保证以下 buffer 长度：
    /// - `result.len() >= num_high`
    /// - `scratch_r.len() >= order + 1`
    /// - `scratch_a.len() >= order + 1`
    /// - `scratch_a_prev.len() >= order + 1`
    /// - `scratch_y.len() >= num_high + order`
    ///
    /// 热路径（super_resolution 每帧调用）使用此版本避免堆分配。
    /// 函数只写入 `result[0..num_high]`，调用方需自行处理其余部分。
    pub fn extrapolate_into(
        &self,
        x: &[f32],
        num_high: usize,
        octaves_per_bin: f32,
        result: &mut [f32],
        scratch_r: &mut [f32],
        scratch_a: &mut [f32],
        scratch_a_prev: &mut [f32],
        scratch_y: &mut [f32],
    ) {
        let order = self.config.order;
        if x.len() < order + 1 || num_high == 0 {
            for v in result.iter_mut().take(num_high) {
                *v = 0.0;
            }
            return;
        }

        // 自相关（写入 scratch_r[0..=order]）
        Self::autocorrelate_into(x, order, scratch_r);

        // 白噪声补偿
        const WHITE_NOISE_FACTOR: f32 = 1e-6;
        scratch_r[0] *= 1.0 + WHITE_NOISE_FACTOR;

        // Levinson-Durbin（写入 scratch_a, scratch_a_prev）
        let _gain = Self::levinson_durbin_into(scratch_r, order, scratch_a, scratch_a_prev);

        // 外推（写入 scratch_y[0..num_high+order]）
        let l = x.len();
        for i in 0..order {
            scratch_y[i] = x[l - order + i].max(1e-10);
        }
        for n in order..(num_high + order) {
            let mut pred = 0.0_f32;
            for k in 1..=order {
                pred -= scratch_a[k] * scratch_y[n - k]; // a[0]=1.0 不参与；a[k] 即 LPC 系数
            }
            scratch_y[n] = pred.abs().max(1e-10);
        }

        // 衰减 + 写入 result
        let per_bin_decay_db = self.config.decay_db_per_oct * octaves_per_bin;
        let per_bin_decay_lin = 10.0_f32.powf(per_bin_decay_db / 20.0);

        let mut decay = 1.0;
        for i in 0..num_high {
            result[i] = scratch_y[order + i] * decay;
            decay *= per_bin_decay_lin;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Levinson-Durbin 正确性：纯正弦波应能被 LPC 完美建模
    #[test]
    fn lpc_levinson_durbin_pure_sine() {
        // 1kHz 正弦波 @ 96kHz，理论上 2 阶 LPC 即可完美预测
        let sr = 96_000.0_f32;
        let f = 1_000.0_f32;
        let x: Vec<f32> = (0..512)
            .map(|n| (2.0 * PI * f * n as f32 / sr).sin())
            .collect();

        let r = LpcExtrapolator::autocorrelate(&x, 8);
        let (a, gain) = LpcExtrapolator::levinson_durbin(&r, 8);

        // 正弦波 LPC 模型：预测误差应很小（接近 0）
        let rel_gain = gain / r[0].sqrt().max(1e-10);
        assert!(
            rel_gain < 0.1,
            "正弦波 LPC 预测误差过大: rel_gain={}",
            rel_gain
        );
        assert_eq!(a.len(), 8);
    }

    /// Levinson-Durbin 边界：零输入应返回全零
    #[test]
    fn lpc_levinson_durbin_silence() {
        let x = vec![0.0; 32];
        let r = LpcExtrapolator::autocorrelate(&x, 8);
        let (a, gain) = LpcExtrapolator::levinson_durbin(&r, 8);
        assert!(a.iter().all(|v| v.abs() < 1e-6));
        assert!(gain < 1e-6);
    }

    /// 外推衰减测试：高频应比低频小（按 -6dB/oct 衰减）
    #[test]
    fn lpc_extrapolate_decays() {
        let config = LpcConfig {
            order: 8,
            decay_db_per_oct: -6.0,
        };
        let extrap = LpcExtrapolator::new(config);

        // 低频能量序列（衰减形）
        let x: Vec<f32> = (0..16).map(|i| 0.5_f32 * 0.9_f32.powi(i as i32)).collect();

        let y = extrap.extrapolate(&x, 16, 1.0 / 16.0);
        assert_eq!(y.len(), 16);
        // 高频应比低频小（衰减）
        let lf_max = x.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
        let hf_max = y.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
        assert!(
            hf_max < lf_max,
            "高频应衰减: lf_max={}, hf_max={}",
            lf_max,
            hf_max
        );
    }

    /// 静音输入应输出静音
    #[test]
    fn lpc_extrapolate_silence() {
        let config = LpcConfig::default();
        let extrap = LpcExtrapolator::new(config);

        let x = vec![1e-10; 32]; // 接近静音
        let y = extrap.extrapolate(&x, 16, 1.0 / 16.0);
        let max_val = y.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
        // 静音 + -6dB/oct 衰减 → 输出极小
        assert!(max_val < 1e-3, "静音输入应输出近零: max_val={}", max_val);
    }

    /// 短输入应返回全零（小于 order+1）
    #[test]
    fn lpc_extrapolate_short_input() {
        let config = LpcConfig {
            order: 8,
            decay_db_per_oct: -6.0,
        };
        let extrap = LpcExtrapolator::new(config);

        let x = vec![0.5; 5]; // < order+1 = 9
        let y = extrap.extrapolate(&x, 16, 1.0 / 16.0);
        let max_val = y.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
        assert!(max_val < 1e-6, "短输入应返回全零: max_val={}", max_val);
    }

    /// 不同阶数测试
    #[test]
    fn lpc_different_orders() {
        for &order in &[2, 4, 8, 16, 32] {
            let config = LpcConfig {
                order,
                decay_db_per_oct: -6.0,
            };
            let extrap = LpcExtrapolator::new(config);

            let x: Vec<f32> = (0..64).map(|i| 0.5 * (i as f32 * 0.1).sin()).collect();
            let y = extrap.extrapolate(&x, 16, 1.0 / 16.0);
            assert_eq!(y.len(), 16);
        }
    }

    /// 外推连续性：外推起点应与输入末尾连续
    #[test]
    fn lpc_extrapolate_continuity() {
        let config = LpcConfig {
            order: 4,
            decay_db_per_oct: 0.0, // 不衰减，便于检查连续性
        };
        let extrap = LpcExtrapolator::new(config);

        // 缓慢变化的序列
        let x: Vec<f32> = (0..32).map(|i| 0.5 + 0.01 * i as f32).collect();
        let y = extrap.extrapolate(&x, 8, 1.0 / 16.0);
        // 外推第一个值应与 x 末尾接近（不衰减时）
        let last_x = x.last().copied().unwrap_or(0.0);
        let first_y = y.first().copied().unwrap_or(0.0);
        // 允许较大误差（LPC 外推不稳定）
        assert!(
            (first_y - last_x).abs() < 1.0,
            "外推连续性失败: last_x={}, first_y={}",
            last_x,
            first_y
        );
    }
}
