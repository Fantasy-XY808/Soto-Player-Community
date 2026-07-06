//! 低音增强 DSP
//!
//! 实现：
//! - 2 阶 low-shelf 滤波器提升低频（默认 100Hz 以下）
//! - tanh 软饱和防止削波
//! - 二阶 subharmonic 生成（80Hz → 40Hz / 20Hz）扩展超低频，制造包裹感
//! - bypass 时零开销

use std::f32::consts::PI;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use parking_lot::Mutex;

/// 谐波生成器参考频率（Hz）—— 80Hz 内容生成 40Hz / 20Hz 谐波
const HARMONIC_FREQ: f32 = 80.0;

/// 低音增强参数
#[derive(Clone, Copy)]
pub struct BassEnhancerParams {
    /// 截止频率（Hz），默认 100
    pub freq: f32,
    /// 增益（dB），范围 [-6, 12]，默认 9
    pub gain_db: f32,
    /// Q 值，默认 0.7
    pub q: f32,
    /// subharmonic 混合比例（0~1），默认 0.4
    pub harmonics_mix: f32,
    /// A/B bypass：true 时跳过 DSP
    pub bypass: bool,
}

impl Default for BassEnhancerParams {
    fn default() -> Self {
        Self {
            freq: 100.0,
            gain_db: 9.0,
            q: 0.7,
            harmonics_mix: 0.4,
            bypass: false,
        }
    }
}

/// 单声道 biquad 状态（Direct Form II Transposed）
#[derive(Clone, Copy, Default)]
struct BiquadState {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl BiquadState {
    fn passthrough() -> Self {
        Self {
            b0: 1.0,
            ..Default::default()
        }
    }

    /// 按 RBJ Cookbook 配置 low-shelf 滤波器系数
    fn configure_lowshelf(&mut self, freq: f32, sample_rate: f32, gain_db: f32, q: f32) {
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

    /// 按 RBJ Cookbook 配置 low-pass 滤波器系数
    fn configure_lowpass(&mut self, freq: f32, sample_rate: f32, q: f32) {
        let omega = 2.0 * PI * freq / sample_rate;
        let cos_omega = omega.cos();
        let sin_omega = omega.sin();
        let alpha = sin_omega / (2.0 * q);

        let b0 = (1.0 - cos_omega) * 0.5;
        let b1 = 1.0 - cos_omega;
        let b2 = (1.0 - cos_omega) * 0.5;
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

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

/// 过零二分频器：检测输入正向过零点，每两次过零翻转输出一次
/// 输出 +1 / -1 的方波，频率为输入的一半（subharmonic）
#[derive(Clone, Copy)]
struct SubharmonicDivider {
    /// 上次样本值（用于检测过零）
    prev: f32,
    /// 当前输出状态（+1 / -1）
    state: f32,
    /// 过零计数（每 2 次翻转一次）
    counter: u32,
}

impl SubharmonicDivider {
    /// 每 N 次正向过零翻转一次（N=2 即二分频）
    const FLIP_THRESHOLD: u32 = 2;

    fn new() -> Self {
        Self {
            prev: 0.0,
            state: 1.0,
            counter: 0,
        }
    }

    fn reset(&mut self) {
        self.prev = 0.0;
        self.state = 1.0;
        self.counter = 0;
    }

    #[inline]
    fn process(&mut self, x: f32) -> f32 {
        // 正向过零：prev <= 0 且 x > 0
        if self.prev <= 0.0 && x > 0.0 {
            self.counter += 1;
            if self.counter >= Self::FLIP_THRESHOLD {
                self.state = -self.state;
                self.counter = 0;
            }
        }
        self.prev = x;
        self.state
    }
}

/// 单声道 subharmonic 生成器：低通提取 → 二分频 → 平滑 → 二次分频 → 二次平滑
struct HarmonicChannel {
    /// 提取 bass 区域的低通滤波器（默认 80Hz）
    bass_extract: BiquadState,
    /// 第一级分频器：80Hz → 40Hz
    divider1: SubharmonicDivider,
    /// 第一级输出整形：低通把方波平滑为正弦形状
    shaper1: BiquadState,
    /// 第二级分频器：40Hz → 20Hz
    divider2: SubharmonicDivider,
    /// 第二级输出整形：低通进一步平滑
    shaper2: BiquadState,
}

impl HarmonicChannel {
    fn new() -> Self {
        Self {
            bass_extract: BiquadState::passthrough(),
            divider1: SubharmonicDivider::new(),
            shaper1: BiquadState::passthrough(),
            divider2: SubharmonicDivider::new(),
            shaper2: BiquadState::passthrough(),
        }
    }

    fn configure(&mut self, sample_rate: f32) {
        // 提取 bass 区域：低通 HARMONIC_FREQ 截止
        self.bass_extract
            .configure_lowpass(HARMONIC_FREQ, sample_rate, 0.707);
        // 一级整形：截止频率设为参考频率的 0.75 倍，平滑方波为正弦
        self.shaper1
            .configure_lowpass(HARMONIC_FREQ * 0.75, sample_rate, 0.707);
        // 二级整形：截止频率再减半，平滑 20Hz 方波
        self.shaper2
            .configure_lowpass(HARMONIC_FREQ * 0.375, sample_rate, 0.707);
    }

    fn reset(&mut self) {
        self.bass_extract.reset();
        self.divider1.reset();
        self.shaper1.reset();
        self.divider2.reset();
        self.shaper2.reset();
    }

    /// 返回 (h1, h2) —— 40Hz 半频分量与 20Hz 四分之一频分量
    #[inline]
    fn process(&mut self, x: f32) -> (f32, f32) {
        let bass = self.bass_extract.process(x);
        let sub1 = self.divider1.process(bass);
        let shaped1 = self.shaper1.process(sub1);
        let sub2 = self.divider2.process(shaped1);
        let shaped2 = self.shaper2.process(sub2);
        (shaped1, shaped2)
    }
}

/// 低音增强处理器
pub struct BassEnhancer {
    enabled: AtomicBool,
    sample_rate: AtomicU32,
    params: Mutex<BassEnhancerParams>,
    filters: Mutex<[BiquadState; 2]>,
    harmonics: Mutex<[HarmonicChannel; 2]>,
}

impl BassEnhancer {
    pub fn new() -> Self {
        let default = BassEnhancerParams::default();
        let mut left = BiquadState::passthrough();
        let mut right = BiquadState::passthrough();
        left.configure_lowshelf(default.freq, 48_000.0, default.gain_db, default.q);
        right.configure_lowshelf(default.freq, 48_000.0, default.gain_db, default.q);
        let mut left_h = HarmonicChannel::new();
        let mut right_h = HarmonicChannel::new();
        left_h.configure(48_000.0);
        right_h.configure(48_000.0);
        Self {
            enabled: AtomicBool::new(false),
            sample_rate: AtomicU32::new(48_000),
            params: Mutex::new(default),
            filters: Mutex::new([left, right]),
            harmonics: Mutex::new([left_h, right_h]),
        }
    }

    /// 配置开关 + 参数
    pub fn configure(&self, enabled: bool, params: BassEnhancerParams) {
        self.enabled.store(enabled, Ordering::Relaxed);
        let rate = self.sample_rate.load(Ordering::Relaxed) as f32;
        let mut p = self.params.lock();
        *p = params;
        let freq = p.freq;
        let gain_db = p.gain_db;
        let q = p.q;
        let bypass = p.bypass;
        drop(p);

        if !enabled || bypass {
            self.filters.lock().iter_mut().for_each(|f| f.reset());
            self.harmonics.lock().iter_mut().for_each(|h| h.reset());
        } else {
            let mut filters = self.filters.lock();
            filters[0].configure_lowshelf(freq, rate, gain_db, q);
            filters[1].configure_lowshelf(freq, rate, gain_db, q);
            let mut harmonics = self.harmonics.lock();
            harmonics[0].configure(rate);
            harmonics[1].configure(rate);
        }
    }

    /// 仅更新参数（不改变 enabled）
    pub fn set_params(&self, params: BassEnhancerParams) {
        let rate = self.sample_rate.load(Ordering::Relaxed) as f32;
        let mut p = self.params.lock();
        let old_freq = p.freq;
        let old_gain = p.gain_db;
        let old_q = p.q;
        let old_harm = p.harmonics_mix;
        *p = params;
        let new_freq = p.freq;
        let new_gain = p.gain_db;
        let new_q = p.q;
        let new_harm = p.harmonics_mix;
        let bypass = p.bypass;
        drop(p);

        let coeff_changed = (old_freq - new_freq).abs() > 0.01
            || (old_gain - new_gain).abs() > 0.01
            || (old_q - new_q).abs() > 0.001
            || (old_harm - new_harm).abs() > 0.001;

        if bypass {
            self.filters.lock().iter_mut().for_each(|f| f.reset());
            self.harmonics.lock().iter_mut().for_each(|h| h.reset());
        } else if coeff_changed {
            let mut filters = self.filters.lock();
            filters[0].configure_lowshelf(new_freq, rate, new_gain, new_q);
            filters[1].configure_lowshelf(new_freq, rate, new_gain, new_q);
            let mut harmonics = self.harmonics.lock();
            harmonics[0].configure(rate);
            harmonics[1].configure(rate);
        }
    }

    pub fn params(&self) -> BassEnhancerParams {
        *self.params.lock()
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn set_sample_rate(&self, sample_rate: f32) {
        self.sample_rate.store(sample_rate as u32, Ordering::Relaxed);
        let p = *self.params.lock();
        let mut filters = self.filters.lock();
        filters[0].configure_lowshelf(p.freq, sample_rate, p.gain_db, p.q);
        filters[1].configure_lowshelf(p.freq, sample_rate, p.gain_db, p.q);
        let mut harmonics = self.harmonics.lock();
        harmonics[0].configure(sample_rate);
        harmonics[1].configure(sample_rate);
    }

    pub fn reset_state(&self) {
        let mut filters = self.filters.lock();
        filters[0].reset();
        filters[1].reset();
        let mut harmonics = self.harmonics.lock();
        harmonics[0].reset();
        harmonics[1].reset();
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
        let harmonics_mix = p.harmonics_mix;
        let mut filters = self.filters.lock();
        let mut harmonics = self.harmonics.lock();
        for chunk in samples.chunks_exact_mut(2) {
            let original_l = chunk[0];
            let original_r = chunk[1];
            // low-shelf 提升低频
            let l = filters[0].process(original_l);
            let r = filters[1].process(original_r);
            // 软饱和防止削波：tanh 平滑过渡，保留 50% 原始 + 50% 饱和
            let l_sat = l * 0.5 + l.tanh() * 0.5;
            let r_sat = r * 0.5 + r.tanh() * 0.5;
            // subharmonic 生成：原始信号经低通提取 bass 后二分频得 40Hz，再分频得 20Hz
            let (h1_l, h2_l) = harmonics[0].process(original_l);
            let (h1_r, h2_r) = harmonics[1].process(original_r);
            // 谐波按 harmonics_mix 比例混合（40Hz + 20Hz 各占一半）
            let harm_l = (h1_l + h2_l) * 0.5 * harmonics_mix;
            let harm_r = (h1_r + h2_r) * 0.5 * harmonics_mix;
            chunk[0] = l_sat + harm_l;
            chunk[1] = r_sat + harm_r;
        }
    }
}

impl Default for BassEnhancer {
    fn default() -> Self {
        Self::new()
    }
}
