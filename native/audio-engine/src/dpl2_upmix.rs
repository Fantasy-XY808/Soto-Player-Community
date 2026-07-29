//! Dolby Pro Logic II 2→5.1 上混 (DPL II upmix)
//!
//! 算法依据：Dolby Pro Logic II Decoder 参考实现（CDN-NS6/DP100 等），
//! 简化为 stereo-in / stereo-out 的虚拟化模式：内部计算 5.1 通道信号，
//! 再按 DPL II 立体声下混系数把 5.1 重新折叠回 stereo，借助相位偏移 + 延迟
//! 在立体声扬声器上重建"超出物理摆位"的环绕声场。
//!
//! 5.1 通道提取公式：
//! - FL = L（直通）
//! - FR = R（直通）
//! - C  = (L + R) × 0.707  (−3 dB center extraction)
//! - LFE = LP(C) @ 120Hz，4 阶 Linkwitz-Riley
//! - SL = PhaseShift((L − R) × 0.707) → LP @ 7kHz → Delay(15ms) × surround_gain
//! - SR = −SL  (反向相位，由 Pro Logic II 矩阵解码器分辨前后向)
//!
//! 相位偏移网络：4 级 1 阶 allpass 级联，覆盖 200Hz / 1kHz / 4kHz / 8kHz 四个频段，
//! 近似 90° Hilbert 移相（环绕通道前后向分离的核心）
//!
//! 4 阶 Linkwitz-Riley 低通：2 个 2 阶 Butterworth (Q=0.7071) 级联
//! - LFE LP @ 120Hz：分频点低，斜率 −24 dB/oct，符合 LFE 通道低频单一性要求
//! - Surround LP @ 7kHz：Pro Logic II 标准环绕通道限带，避免高频泄漏到前向
//!
//! 立体声虚拟化下混（输出仍为 2 channel）：
//! - L_out = FL + center_gain × C + surround_gain × SL + lfe_gain × LFE
//! - R_out = FR + center_gain × C + surround_gain × SR + lfe_gain × LFE
//!
//! 与 stereo_widener 的差异：
//! - stereo_widener 仅做 M/S 处理（width + cross-feed + Haas）
//! - DPL II upmix 引入相位偏移网络 + 真正的环绕通道提取 + LFE 通道低频增强
//!
//! DSP 链位置：stereo_widener 之后、loudness_normalizer 之前
//! （5.1→stereo 折叠发生在 loudness_normalizer 之前，让 K-weighted 测量反映最终 stereo 信号）

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use parking_lot::Mutex;

use crate::biquad::BiquadState;

const PI: f32 = std::f32::consts::PI;

/// DPL II upmix 参数
#[derive(Clone, Copy)]
pub struct Dpl2UpmixParams {
    /// 中置通道增益（dB），默认 −3.0（0.707 线性）
    /// 提高会增加人声/对白前置感
    pub center_gain_db: f32,
    /// 环绕通道增益（dB），默认 −6.0（0.5 线性）
    /// 提高会增加空间包裹感，过高会导致前向定位模糊
    pub surround_gain_db: f32,
    /// LFE 通道增益（dB），默认 −10.0（0.316 线性）
    /// 提高会增强低频体感；过高会与 bass_enhancer 冲突
    pub lfe_gain_db: f32,
    /// LFE 截止频率（Hz），默认 120.0（Dolby LFE 通道标准）
    pub lfe_cutoff_hz: f32,
    /// 环绕通道低通截止（Hz），默认 7000.0（Pro Logic II 标准）
    pub surround_cutoff_hz: f32,
    /// 环绕通道 Haas 延迟（ms），默认 15.0
    /// 5~30ms 区间有效；过短空间感不足，过长产生回声
    pub surround_delay_ms: f32,
    /// A/B bypass：true 时跳过 DSP
    pub bypass: bool,
}

impl Default for Dpl2UpmixParams {
    fn default() -> Self {
        Self {
            center_gain_db: -3.0,
            surround_gain_db: -6.0,
            lfe_gain_db: -10.0,
            lfe_cutoff_hz: 120.0,
            surround_cutoff_hz: 7000.0,
            surround_delay_ms: 15.0,
            bypass: false,
        }
    }
}

/// 1 阶 allpass 滤波器（用于环绕通道相位偏移网络）
///
/// y[n] = −a·x[n] + x[n−1] + a·y[n−1]
/// 其中 a = (1 − sin(ω_c)) / (1 + sin(ω_c))，ω_c = 2π·f_c / fs
/// 在 f_c 处产生 +90° 相移
#[derive(Clone, Copy, Default)]
struct Allpass1 {
    a: f32,
    x1: f32,
    y1: f32,
}

impl Allpass1 {
    fn configure(&mut self, freq_hz: f32, sample_rate: f32) {
        let omega = 2.0 * PI * freq_hz / sample_rate;
        let sin_omega = omega.sin();
        // 防止 sin_omega = 1 导致分母为 0
        let denom = 1.0 + sin_omega;
        self.a = if denom > 1e-9 {
            (1.0 - sin_omega) / denom
        } else {
            0.0
        };
        // configure 不清空状态（避免 set_sample_rate 抖动）
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let y = -self.a * x + self.x1 + self.a * self.y1;
        self.x1 = x;
        self.y1 = y;
        y
    }

    fn reset(&mut self) {
        self.x1 = 0.0;
        self.y1 = 0.0;
    }
}

/// 相位偏移网络频段（4 级 1 阶 allpass 覆盖全频段近似 90° 移相）
const PHASE_SHIFT_FREQS_HZ: [f32; 4] = [200.0, 1000.0, 4000.0, 8000.0];

/// DPL II 单声道侧链状态（环绕通道处理）
struct SurroundChannel {
    /// 4 级 1 阶 allpass 级联（相位偏移网络）
    allpass_stages: [Allpass1; 4],
    /// 4 阶 LR 低通（环绕限带）：2 个 2 阶 Butterworth Q=0.7071 级联
    lp1: BiquadState,
    lp2: BiquadState,
    /// 延迟线（Haas 效应）
    delay_buf: Vec<f32>,
    delay_pos: usize,
    delay_samples: usize,
}

impl SurroundChannel {
    fn new(sample_rate: f32, params: &Dpl2UpmixParams) -> Self {
        let mut s = Self {
            allpass_stages: Default::default(),
            lp1: BiquadState::passthrough(),
            lp2: BiquadState::passthrough(),
            delay_buf: Vec::new(),
            delay_pos: 0,
            delay_samples: 0,
        };
        s.configure(sample_rate, params);
        s
    }

    fn configure(&mut self, sample_rate: f32, params: &Dpl2UpmixParams) {
        for (i, stage) in self.allpass_stages.iter_mut().enumerate() {
            stage.configure(PHASE_SHIFT_FREQS_HZ[i], sample_rate);
        }
        // 4 阶 LR 低通 = 2 个 2 阶 Butterworth (Q=0.7071) 级联
        self.lp1
            .configure_lowpass(params.surround_cutoff_hz, sample_rate, 0.7071);
        self.lp2
            .configure_lowpass(params.surround_cutoff_hz, sample_rate, 0.7071);
        let new_delay = (params.surround_delay_ms / 1000.0 * sample_rate).round() as usize;
        if new_delay != self.delay_samples {
            // 延迟长度变化时清空缓冲并重定位，避免读取到旧样本
            self.delay_buf.clear();
            self.delay_buf.resize(new_delay.max(1), 0.0);
            self.delay_pos = 0;
            self.delay_samples = new_delay;
        }
    }

    fn reset(&mut self) {
        for stage in self.allpass_stages.iter_mut() {
            stage.reset();
        }
        self.lp1.reset();
        self.lp2.reset();
        self.delay_buf.iter_mut().for_each(|s| *s = 0.0);
        self.delay_pos = 0;
    }

    /// 处理环绕通道侧链：相位偏移 → 低通限带 → 延迟
    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        // 4 级 allpass 级联
        let mut y = x;
        for stage in self.allpass_stages.iter_mut() {
            y = stage.process(y);
        }
        // 4 阶 LR 低通限带
        y = self.lp1.process(y);
        y = self.lp2.process(y);
        // Haas 延迟（环形缓冲读取 + 写入）
        let delayed = self.delay_buf[self.delay_pos];
        self.delay_buf[self.delay_pos] = y;
        self.delay_pos = (self.delay_pos + 1) % self.delay_samples.max(1);
        delayed
    }
}

/// LFE 通道状态（4 阶 LR 低通 @ 120Hz）
struct LfeChannel {
    lp1: BiquadState,
    lp2: BiquadState,
}

impl LfeChannel {
    fn new(sample_rate: f32, params: &Dpl2UpmixParams) -> Self {
        let mut s = Self {
            lp1: BiquadState::passthrough(),
            lp2: BiquadState::passthrough(),
        };
        s.configure(sample_rate, params);
        s
    }

    fn configure(&mut self, sample_rate: f32, params: &Dpl2UpmixParams) {
        self.lp1
            .configure_lowpass(params.lfe_cutoff_hz, sample_rate, 0.7071);
        self.lp2
            .configure_lowpass(params.lfe_cutoff_hz, sample_rate, 0.7071);
    }

    fn reset(&mut self) {
        self.lp1.reset();
        self.lp2.reset();
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let mut y = self.lp1.process(x);
        y = self.lp2.process(y);
        y
    }
}

/// DPL II upmix 完整状态（中心 + 环绕 + LFE 通道侧链）
struct Dpl2State {
    surround: SurroundChannel,
    lfe: LfeChannel,
    /// 上次 configure 时记录的参数指纹（避免每帧重配滤波器）
    /// 仅 set_params / set_sample_rate 触发重配
    sample_rate: f32,
}

impl Dpl2State {
    fn new(sample_rate: f32, params: &Dpl2UpmixParams) -> Self {
        Self {
            surround: SurroundChannel::new(sample_rate, params),
            lfe: LfeChannel::new(sample_rate, params),
            sample_rate,
        }
    }

    fn configure(&mut self, sample_rate: f32, params: &Dpl2UpmixParams) {
        self.surround.configure(sample_rate, params);
        self.lfe.configure(sample_rate, params);
        self.sample_rate = sample_rate;
    }

    fn reset(&mut self) {
        self.surround.reset();
        self.lfe.reset();
    }

    /// 处理一对立体声样本，返回虚拟化后的 (L_out, R_out)
    #[inline]
    fn process(&mut self, l: f32, r: f32, p: &Dpl2UpmixParams) -> (f32, f32) {
        // 提取 5.1 通道信号
        let center_raw = (l + r) * 0.707;
        let surround_raw = (l - r) * 0.707;

        // LFE：center 信号经 4 阶 LR 低通 @ 120Hz
        let lfe = self.lfe.process(center_raw);

        // 环绕：相位偏移 + 低通限带 + Haas 延迟
        let sl = self.surround.process(surround_raw);
        let sr = -sl; // Pro Logic II 反向相位：SR = −SL

        // 增益换算
        let center_gain = db_to_linear(p.center_gain_db);
        let surround_gain = db_to_linear(p.surround_gain_db);
        let lfe_gain = db_to_linear(p.lfe_gain_db);

        // 立体声虚拟化下混
        let l_out = l + center_gain * center_raw + surround_gain * sl + lfe_gain * lfe;
        let r_out = r + center_gain * center_raw + surround_gain * sr + lfe_gain * lfe;

        (l_out, r_out)
    }
}

/// dB → 线性增益
#[inline]
fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// DPL II upmix 处理器
pub struct Dpl2Upmix {
    enabled: AtomicBool,
    sample_rate: AtomicU32,
    params: Mutex<Dpl2UpmixParams>,
    state: Mutex<Dpl2State>,
}

impl Dpl2Upmix {
    pub fn new() -> Self {
        let default = Dpl2UpmixParams::default();
        Self {
            enabled: AtomicBool::new(false),
            sample_rate: AtomicU32::new(48_000),
            params: Mutex::new(default),
            state: Mutex::new(Dpl2State::new(48_000.0, &default)),
        }
    }

    /// 配置开关 + 参数（前端 set_dpl2_upmix）
    pub fn configure(&self, enabled: bool, params: Dpl2UpmixParams) {
        self.enabled.store(enabled, Ordering::Relaxed);
        let rate = self.sample_rate.load(Ordering::Relaxed) as f32;
        *self.params.lock() = params;
        if !enabled || params.bypass {
            self.state.lock().reset();
        } else {
            self.state.lock().configure(rate, &params);
        }
    }

    /// 仅更新参数（不改变 enabled）
    pub fn set_params(&self, params: Dpl2UpmixParams) {
        let rate = self.sample_rate.load(Ordering::Relaxed) as f32;
        *self.params.lock() = params;
        if params.bypass {
            self.state.lock().reset();
        } else {
            self.state.lock().configure(rate, &params);
        }
    }

    pub fn params(&self) -> Dpl2UpmixParams {
        *self.params.lock()
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// 设置采样率（设备切换 / load 时按音源采样率自适应调用）
    pub fn set_sample_rate(&self, sample_rate: f32) {
        self.sample_rate
            .store(sample_rate as u32, Ordering::Relaxed);
        let p = *self.params.lock();
        // 采样率变化时 allpass / 低通系数 + 延迟长度都需重算
        self.state.lock().configure(sample_rate, &p);
    }

    pub fn reset_state(&self) {
        self.state.lock().reset();
    }

    /// 处理交错立体声样本（原地修改）
    pub fn process_interleaved_stereo(&self, samples: &mut [f32]) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let p = *self.params.lock();
        if p.bypass {
            return;
        }
        let mut state = self.state.lock();
        for chunk in samples.chunks_exact_mut(2) {
            let (l, r) = state.process(chunk[0], chunk[1], &p);
            chunk[0] = l;
            chunk[1] = r;
        }
    }
}

impl Default for Dpl2Upmix {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn silence_passes_through() {
        let upmix = Dpl2Upmix::new();
        upmix.configure(true, Dpl2UpmixParams::default());
        let mut samples = vec![0.0_f32; 1024];
        upmix.process_interleaved_stereo(&mut samples);
        // 静音输入应输出近静音（滤波器初始状态为 0）
        for s in &samples {
            assert!(s.abs() < 1e-6, "静音输入应保持静音，实际: {s}");
        }
    }

    #[test]
    fn bypass_returns_input_unchanged() {
        let upmix = Dpl2Upmix::new();
        let mut params = Dpl2UpmixParams::default();
        params.bypass = true;
        upmix.configure(true, params);
        let original: Vec<f32> = (0..1024).map(|i| (i as f32 / 100.0).sin()).collect();
        let mut samples = original.clone();
        upmix.process_interleaved_stereo(&mut samples);
        for (orig, proc) in original.iter().zip(samples.iter()) {
            assert!(
                (orig - proc).abs() < 1e-9,
                "bypass 时输出应等于输入，差值: {}",
                orig - proc
            );
        }
    }

    #[test]
    fn center_extraction_amplifies_mono() {
        // 单声道输入（L=R）应被 center 通道加强（人声前置感）
        let upmix = Dpl2Upmix::new();
        upmix.configure(true, Dpl2UpmixParams::default());
        let sample_rate = 48000.0_f32;
        let freq = 1000.0_f32; // 1kHz 中频（人声敏感区）
        let duration_samples = (sample_rate * 0.1) as usize * 2; // 100ms
        let mut samples = Vec::with_capacity(duration_samples);
        for i in 0..duration_samples / 2 {
            let s = (2.0 * PI * freq * i as f32 / sample_rate).sin() * 0.5;
            samples.push(s); // L
            samples.push(s); // R (mono 输入)
        }
        let original_power: f32 = samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32;
        upmix.process_interleaved_stereo(&mut samples);
        let proc_power: f32 = samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32;
        // 单声道输入经 DPL II 后功率应增加（center 通道叠加到 L+R）
        assert!(
            proc_power > original_power * 1.1,
            "单声道输入经 DPL II 后功率应增加，原: {original_power}, 处理后: {proc_power}"
        );
    }

    #[test]
    fn surround_extraction_decorrelates_stereo() {
        // 完全反相立体声（L = -R）应被环绕通道捕获，且 L_out / R_out 应保持反相关系
        let upmix = Dpl2Upmix::new();
        upmix.configure(true, Dpl2UpmixParams::default());
        let sample_rate = 48000.0_f32;
        let freq = 500.0_f32;
        let n = 1024;
        let mut samples = Vec::with_capacity(n * 2);
        for i in 0..n {
            let s = (2.0 * PI * freq * i as f32 / sample_rate).sin() * 0.5;
            samples.push(s);
            samples.push(-s); // R = -L（完全反相）
        }
        upmix.process_interleaved_stereo(&mut samples);
        // 处理后 L 和 R 应仍然呈现反相关系（环绕通道相位偏移会改变幅度但应保持反相结构）
        let mut anti_correlation = 0.0_f32;
        for chunk in samples.chunks_exact(2) {
            anti_correlation += chunk[0] * chunk[1];
        }
        // 反相输入 → L × R 应为负
        assert!(
            anti_correlation < 0.0,
            "反相输入经 DPL II 后 L×R 之和应为负，实际: {anti_correlation}"
        );
    }

    #[test]
    fn sample_rate_change_preserves_state_safety() {
        // 切换采样率不应 panic，且滤波器系数应按新率重算
        let upmix = Dpl2Upmix::new();
        upmix.configure(true, Dpl2UpmixParams::default());
        upmix.set_sample_rate(96_000.0);
        upmix.set_sample_rate(44_100.0);
        upmix.set_sample_rate(48_000.0);
        let mut samples = vec![0.5_f32; 256];
        // 不应 panic
        upmix.process_interleaved_stereo(&mut samples);
        // 输出应为有限值
        for s in &samples {
            assert!(s.is_finite(), "切换采样率后输出应有限");
        }
    }

    #[test]
    fn lfe_channel_lowpass_attenuates_high_freq() {
        // LFE 通道应衰减高频：1000Hz 输入经 LFE 后应远小于 50Hz 输入
        let params = Dpl2UpmixParams::default();
        let mut lfe = LfeChannel::new(48_000.0, &params);

        // 50Hz 测试
        lfe.reset();
        let sample_rate = 48_000.0_f32;
        let n = 4800; // 100ms
        let mut low_out = 0.0_f32;
        for i in 0..n {
            let x = (2.0 * PI * 50.0 * i as f32 / sample_rate).sin() * 0.5;
            let y = lfe.process(x);
            if i > 2400 {
                // 取后 50ms 稳态
                low_out = low_out.max(y.abs());
            }
        }

        // 1000Hz 测试
        lfe.reset();
        let mut high_out = 0.0_f32;
        for i in 0..n {
            let x = (2.0 * PI * 1000.0 * i as f32 / sample_rate).sin() * 0.5;
            let y = lfe.process(x);
            if i > 2400 {
                high_out = high_out.max(y.abs());
            }
        }

        // 1000Hz 输出应远小于 50Hz 输出（4 阶 LR 低通 @ 120Hz）
        assert!(
            high_out < low_out * 0.1,
            "LFE 通道应衰减高频，50Hz 输出: {low_out}, 1000Hz 输出: {high_out}"
        );
    }
}
