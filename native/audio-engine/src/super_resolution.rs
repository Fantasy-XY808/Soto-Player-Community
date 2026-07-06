//! 音频超分 DSP（SBR-like 频带扩展 + 高频激励器 + 临场感提升）
//!
//! 实现方式（三段式 SBR-like + 临场感提升）：
//!   1. Linkwitz-Riley 二阶高通（hp_freq，默认 3.5kHz）提取高频成分
//!   2. 带通滤波在 2×hp_freq 处提取"折叠源"频带（6~9kHz），用于频带扩展
//!   3. tanh 软饱和生成奇次谐波 + 平方生成偶次谐波，模拟缺失的高频细节
//!   4. 折叠源带通信号与 HP 信号相加后再饱和，模拟 SBR 的高频重建
//!   5. 与原始信号混合（默认 wet 占比 55%），明显可感
//!   6. 临场感提升：2-4kHz 频段 +2dB 峰值均衡，让人声/乐器更靠前，提升"咬人"感
//!
//! 与真正 SBR 的差异：未做 QMF 分析与瞬时包络跟踪，效果上为"频带扩展激励器"，
//! 但相比纯激励器多了折叠源带通与饱和级联，听感上更接近带宽扩展
//!
//! 后端选择：
//!   - Cpu: 真实实现,biquad + 软饱和 + 谐波生成
//!   - Gpu / Npu: 当前回退到 Cpu (GPU/NPU 未实现)，真正实现需 WebGPU compute shader 或 ONNX Runtime
//!     configure 时若 GPU/NPU 被请求但回退到 CPU，输出 warn 日志（一次性，避免刷屏）

use std::f32::consts::PI;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};

use parking_lot::Mutex;
use tracing::warn;

/// 临场感提升中心频率（Hz）：人声/乐器存在感最敏感频段
const PRESENCE_FREQ: f32 = 3000.0;
/// 临场感提升增益（dB）：+2dB 让人声/乐器更靠前
const PRESENCE_GAIN_DB: f32 = 2.0;
/// 临场感提升 Q 值：0.7 = Butterworth 平坦响应，影响范围宽
const PRESENCE_Q: f32 = 0.7;

/// 超分后端
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SuperResBackend {
    /// CPU biquad + soft clip
    Cpu,
    /// GPU(WebGPU compute),当前回退到 CPU
    Gpu,
    /// NPU(ONNX Runtime),当前回退到 CPU
    Npu,
}

impl SuperResBackend {
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Gpu,
            2 => Self::Npu,
            _ => Self::Cpu,
        }
    }

    pub fn to_u8(self) -> u8 {
        match self {
            Self::Cpu => 0,
            Self::Gpu => 1,
            Self::Npu => 2,
        }
    }
}

/// 超分参数（可配置，前端可热更新）
#[derive(Clone, Copy)]
pub struct SuperResParams {
    /// 高通截止频率(Hz):3.5kHz 覆盖人耳敏感的"空气感"与"细节感"频段
    pub hp_freq: f32,
    /// 高通 Q 值:0.7 = Butterworth 平坦响应
    pub hp_q: f32,
    /// 高频激励驱动强度:tanh 软饱和输入增益,越大谐波越丰富
    pub drive: f32,
    /// 二次谐波驱动强度:对全频段轻微偶次谐波,增加"温暖感"
    pub h2_drive: f32,
    /// 二次谐波混合比例:18%,辅助增色不喧宾夺主
    pub h2_mix: f32,
    /// 湿信号混合比例:55%,明显可感的高频细节增强
    pub wet_mix: f32,
    /// 安全限制:输入样本超过此值跳过激励(避免削波样本产生过多谐波)
    pub input_limit: f32,
    /// A/B bypass:true 时跳过 DSP（用于对比效果）
    pub bypass: bool,
}

impl Default for SuperResParams {
    fn default() -> Self {
        Self {
            hp_freq: 3500.0,
            hp_q: 0.7,
            drive: 4.5,
            h2_drive: 0.6,
            h2_mix: 0.18,
            wet_mix: 0.55,
            input_limit: 1.2,
            bypass: false,
        }
    }
}

/// 单声道 biquad 状态(Direct Form II Transposed)
///
/// 暴露为 `pub(crate)` 供 neural_upsample 等模块复用，
/// 避免在不同 DSP 模块中重复实现 RBJ Cookbook 公式
#[derive(Clone, Copy, Default)]
pub(crate) struct BiquadState {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl BiquadState {
    pub(crate) fn passthrough() -> Self {
        Self {
            b0: 1.0,
            ..Default::default()
        }
    }

    /// 按 RBJ Cookbook 配置高通滤波器系数
    pub(crate) fn configure_highpass(&mut self, freq: f32, sample_rate: f32, q: f32) {
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
    pub(crate) fn configure_lowpass(&mut self, freq: f32, sample_rate: f32, q: f32) {
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

    /// 按 RBJ Cookbook 配置带通滤波器（常量 0dB 峰值增益）
    /// 用于 SBR-like 折叠源带通：在 2×hp_freq 处取一个窄带，作为高频重建的"种子"
    pub(crate) fn configure_bandpass(&mut self, freq: f32, sample_rate: f32, q: f32) {
        let omega = 2.0 * PI * freq / sample_rate;
        let cos_omega = omega.cos();
        let sin_omega = omega.sin();
        let alpha = sin_omega / (2.0 * q);

        // RBJ Bandpass (constant 0 dB peak gain)
        let b0 = alpha;
        let b1 = 0.0;
        let b2 = -alpha;
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

    /// 按 RBJ Cookbook 配置峰值均衡滤波器（peaking EQ）
    /// 在指定频率处提供恒定增益（gain_db），影响范围由 Q 决定
    /// 用于临场感提升：3kHz 处 +2dB，让人声/乐器更靠前
    pub(crate) fn configure_peaking(&mut self, freq: f32, sample_rate: f32, gain_db: f32, q: f32) {
        let omega = 2.0 * PI * freq / sample_rate;
        let cos_omega = omega.cos();
        let sin_omega = omega.sin();
        let alpha = sin_omega / (2.0 * q);
        let a = 10.0_f32.powf(gain_db / 40.0);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_omega;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_omega;
        let a2 = 1.0 - alpha / a;

        let inv_a0 = 1.0 / a0;
        self.b0 = b0 * inv_a0;
        self.b1 = b1 * inv_a0;
        self.b2 = b2 * inv_a0;
        self.a1 = a1 * inv_a0;
        self.a2 = a2 * inv_a0;
    }

    #[inline]
    pub(crate) fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    pub(crate) fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

/// 单声道滤波器组（HP + BP + 临场感峰值，SBR-like 频带扩展 + 临场感提升）
#[derive(Clone, Copy, Default)]
struct ChannelFilter {
    hp: BiquadState,
    bp: BiquadState,
    /// 临场感提升峰值滤波器：3kHz 处 +2dB
    presence: BiquadState,
}

impl ChannelFilter {
    fn passthrough() -> Self {
        Self {
            hp: BiquadState::passthrough(),
            bp: BiquadState::passthrough(),
            presence: BiquadState::passthrough(),
        }
    }

    fn reset(&mut self) {
        self.hp.reset();
        self.bp.reset();
        self.presence.reset();
    }
}

/// 超分处理器:立体声双声道独立滤波器状态
pub struct SuperResolution {
    /// 是否启用(false = 直通)
    enabled: AtomicBool,
    /// 实际生效的后端(GPU/NPU 回退到 CPU 时仍报告 CPU)
    effective_backend: AtomicU8,
    /// 当前采样率（params 更新时按此率重建高通系数）
    sample_rate: AtomicU32,
    /// 可配置参数（含 bypass）
    params: Mutex<SuperResParams>,
    /// 滤波器状态(左右声道独立；每声道 HP + BP 双段)
    filters: Mutex<[ChannelFilter; 2]>,
    /// GPU/NPU 回退警告是否已输出过（避免每帧刷屏）
    fallback_warned: AtomicBool,
}

impl SuperResolution {
    pub fn new() -> Self {
        let default_params = SuperResParams::default();
        let mut left = ChannelFilter::passthrough();
        let mut right = ChannelFilter::passthrough();
        // 默认 48kHz 配置,set_sample_rate 会在播放开始时按实际率纠正
        let hp_freq = default_params.hp_freq;
        let hp_q = default_params.hp_q;
        Self::configure_channel(&mut left, hp_freq, 48_000.0, hp_q);
        Self::configure_channel(&mut right, hp_freq, 48_000.0, hp_q);
        Self {
            enabled: AtomicBool::new(false),
            effective_backend: AtomicU8::new(0),
            sample_rate: AtomicU32::new(48_000),
            params: Mutex::new(default_params),
            filters: Mutex::new([left, right]),
            fallback_warned: AtomicBool::new(false),
        }
    }

    /// 按 hp_freq / 采样率 / Q 重建单声道的 HP + BP + 临场感系数
    /// BP 中心频率取 2×hp_freq，模拟 SBR 把低频段折叠到高频段的频带扩展
    /// 临场感峰值固定在 3kHz +2dB，与 hp_freq 无关
    fn configure_channel(filter: &mut ChannelFilter, hp_freq: f32, sample_rate: f32, q: f32) {
        filter.hp.configure_highpass(hp_freq, sample_rate, q);
        // 折叠源带通：2×hp_freq 处取窄带（Q=2.0 保证窄带）
        let bp_freq = (hp_freq * 2.0).min(sample_rate * 0.45);
        filter.bp.configure_bandpass(bp_freq, sample_rate, 2.0);
        // 临场感提升：3kHz 处 +2dB，让人声/乐器更靠前
        filter
            .presence
            .configure_peaking(PRESENCE_FREQ, sample_rate, PRESENCE_GAIN_DB, PRESENCE_Q);
    }

    /// 配置开关与后端，并热更新参数
    /// GPU/NPU 后端当前回退到 Cpu (GPU/NPU 未实现)；首次回退时输出 warn 日志
    pub fn configure(&self, enabled: bool, backend: SuperResBackend, params: SuperResParams) {
        self.enabled.store(enabled, Ordering::Relaxed);
        // 实际生效后端:CPU 始终可用,GPU/NPU 暂回退到 Cpu (GPU/NPU 未实现)
        let (effective, requested_fallback) = match backend {
            SuperResBackend::Cpu => (SuperResBackend::Cpu, false),
            SuperResBackend::Gpu | SuperResBackend::Npu => {
                // 一次性 warn：用户请求 GPU/NPU 但当前回退到 Cpu (GPU/NPU 未实现)
                if !self.fallback_warned.swap(true, Ordering::Relaxed) {
                    let requested_str = if matches!(backend, SuperResBackend::Gpu) {
                        "GPU(WebGPU compute)"
                    } else {
                        "NPU(ONNX Runtime)"
                    };
                    warn!(
                        requested = requested_str,
                        effective = "Cpu (GPU/NPU 未实现)",
                        "音频超分后端 {} 未实现，回退到 Cpu (GPU/NPU 未实现)；\
                         真实 GPU/NPU 推理需 WebGPU compute shader 或 ONNX Runtime 集成",
                        requested_str,
                    );
                }
                (SuperResBackend::Cpu, true)
            }
        };
        // 用户切回 CPU 时清除警告标志，下次再切 GPU/NPU 时重新 warn
        if !requested_fallback {
            self.fallback_warned.store(false, Ordering::Relaxed);
        }
        self.effective_backend.store(effective.to_u8(), Ordering::Relaxed);

        let rate = self.sample_rate.load(Ordering::Relaxed) as f32;
        let mut p = self.params.lock();
        *p = params;
        let hp_freq = p.hp_freq;
        let hp_q = p.hp_q;
        let should_reset = !enabled || p.bypass;
        drop(p);

        if should_reset {
            self.filters.lock().iter_mut().for_each(|f| f.reset());
        } else {
            // freq/q 可能变了，按当前采样率重建系数
            let mut filters = self.filters.lock();
            Self::configure_channel(&mut filters[0], hp_freq, rate, hp_q);
            Self::configure_channel(&mut filters[1], hp_freq, rate, hp_q);
        }
    }

    /// 仅更新参数（不改变 enabled / backend）
    pub fn set_params(&self, params: SuperResParams) {
        let rate = self.sample_rate.load(Ordering::Relaxed) as f32;
        let mut p = self.params.lock();
        let old_hp_freq = p.hp_freq;
        let old_hp_q = p.hp_q;
        *p = params;
        let new_hp_freq = p.hp_freq;
        let new_hp_q = p.hp_q;
        let bypass_now = p.bypass;
        drop(p);

        // freq/q 变化或刚切到 bypass 时需要重建/重置滤波器
        let coeff_changed =
            (old_hp_freq - new_hp_freq).abs() > 0.01 || (old_hp_q - new_hp_q).abs() > 0.001;

        if bypass_now {
            self.filters.lock().iter_mut().for_each(|f| f.reset());
        } else if coeff_changed {
            let mut filters = self.filters.lock();
            Self::configure_channel(&mut filters[0], new_hp_freq, rate, new_hp_q);
            Self::configure_channel(&mut filters[1], new_hp_freq, rate, new_hp_q);
        }
    }

    /// 取当前参数副本（lib.rs getter 用）
    pub fn params(&self) -> SuperResParams {
        *self.params.lock()
    }

    /// 暴露当前生效后端(供 UI 显示是否回退)
    pub fn effective_backend(&self) -> SuperResBackend {
        SuperResBackend::from_u8(self.effective_backend.load(Ordering::Relaxed))
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// 按当前采样率重建滤波器系数(load/seek 时由 player 调用)
    pub fn set_sample_rate(&self, sample_rate: f32) {
        self.sample_rate.store(sample_rate as u32, Ordering::Relaxed);
        let p = *self.params.lock();
        let mut filters = self.filters.lock();
        Self::configure_channel(&mut filters[0], p.hp_freq, sample_rate, p.hp_q);
        Self::configure_channel(&mut filters[1], p.hp_freq, sample_rate, p.hp_q);
    }

    /// 重置滤波器状态(切歌时调用,避免上一首尾音残留)
    pub fn reset_state(&self) {
        let mut filters = self.filters.lock();
        filters[0].reset();
        filters[1].reset();
    }

    /// 处理交错立体声样本(原地修改)
    /// 关闭/bypass 时直接返回,零开销;开启时按声道应用 HP + BP 双段 + tanh 软饱和 + 二次谐波 + 混合
    pub fn process_interleaved_stereo(&self, samples: &mut [f32]) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        // 持锁期间读一次 params 副本，避免每个样本都锁
        let p = *self.params.lock();
        if p.bypass {
            return;
        }
        let mut filters = self.filters.lock();
        let chunks = samples.chunks_exact_mut(2);
        for chunk in chunks {
            let left = chunk[0];
            let right = chunk[1];
            // 输入超限(已削波)时不激励,避免谐波堆积导致进一步削波
            if left.abs() < p.input_limit {
                chunk[0] = Self::process_sample(left, &mut filters[0], &p);
            }
            if right.abs() < p.input_limit {
                chunk[1] = Self::process_sample(right, &mut filters[1], &p);
            }
        }
    }

    /// 单声道单样本处理：HP + BP 折叠源 + tanh 软饱和 + 二次谐波 + 混合 + 临场感峰值
    #[inline]
    fn process_sample(input: f32, filter: &mut ChannelFilter, p: &SuperResParams) -> f32 {
        // HP 段：提取高频成分
        let hp = filter.hp.process(input);
        // BP 折叠源：2×hp_freq 处的窄带，作为 SBR 高频重建的"种子"
        // 折叠源信号本身就是输入的高频成分，无需额外混入；通过 BP 提取后做软饱和，
        // 等价于在原高频基础上"扩展"出更丰富的谐波细节
        let bp = filter.bp.process(input);
        // tanh 软饱和:平滑过渡到饱和,奇次谐波丰富且听感自然
        let driven_hp = hp * p.drive;
        let wet_hp = driven_hp.tanh();
        // 折叠源二次饱和：把 BP 信号也做软饱和后并入湿路径
        // BP 信号幅度通常远小于 HP，drives 折叠源饱和后与 HP 相加
        let driven_bp = bp * p.drive * 0.5;
        let wet_bp = driven_bp.tanh();
        let wet = wet_hp + wet_bp * 0.5;
        // 二次谐波:全频段轻微偶次谐波,增加"温暖感"
        let h2_input = input * p.h2_drive;
        let h2 = h2_input * h2_input * 0.5;
        let combined = input + wet * p.wet_mix + h2 * p.h2_mix;
        // 临场感提升：3kHz +2dB 峰值均衡，让人声/乐器更靠前，提升"咬人"感
        filter.presence.process(combined)
    }
}

impl Default for SuperResolution {
    fn default() -> Self {
        Self::new()
    }
}
