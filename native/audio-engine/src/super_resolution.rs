//! 音频超分 DSP
//!
//! 实现方式:高频激励器(Exciter) + 二次谐波生成
//!   1. 高通滤波器(4.5kHz)提取高频成分
//!   2. tanh 软饱和生成奇次谐波,模拟超分重建的高频细节
//!   3. 全频段二次谐波(偶次)增加"温暖感"与细节
//!   4. 与原始信号混合(wet 占比 40%),明显可感
//!
//! 后端选择:
//!   - Cpu: 真实实现,biquad + 软饱和 + 谐波生成
//!   - Gpu / Npu: 当前回退到 Cpu,真正实现需 WebGPU compute shader 或 ONNX Runtime
//!     (返回 Backend 表明当前实际使用的后端,前端可据此显示提示)

use std::f32::consts::PI;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use parking_lot::Mutex;

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

/// 高通滤波器截止频率(Hz):4.5kHz,覆盖人耳敏感的"空气感"与"细节感"频段
const HP_FREQ: f32 = 4500.0;
/// 高通 Q 值:0.7 = Butterworth 平坦响应
const HP_Q: f32 = 0.7;
/// 高频激励驱动强度:tanh 软饱和输入增益,越大谐波越丰富
const DRIVE: f32 = 3.0;
/// 二次谐波驱动强度:对全频段轻微偶次谐波,增加"温暖感"
const H2_DRIVE: f32 = 0.6;
/// 二次谐波混合比例:8%,作为辅助增色,不喧宾夺主
const H2_MIX: f32 = 0.08;
/// 湿信号混合比例:40%,明显可感的高频细节增强
const WET_MIX: f32 = 0.40;
/// 安全限制:输入样本超过此值跳过激励(避免削波样本产生过多谐波)
const INPUT_LIMIT: f32 = 1.2;

/// 单声道 biquad 状态(Direct Form II Transposed)
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

    /// 按 RBJ Cookbook 配置高通滤波器系数
    fn configure_highpass(&mut self, freq: f32, sample_rate: f32, q: f32) {
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

/// 超分处理器:立体声双声道独立滤波器状态
pub struct SuperResolution {
    /// 是否启用(false = 直通)
    enabled: AtomicBool,
    /// 实际生效的后端(GPU/NPU 回退到 CPU 时仍报告 CPU)
    effective_backend: AtomicU8,
    /// 滤波器状态(左右声道独立)
    filters: Mutex<[BiquadState; 2]>,
}

impl SuperResolution {
    pub fn new() -> Self {
        let mut left = BiquadState::passthrough();
        let mut right = BiquadState::passthrough();
        // 默认 48kHz 配置,set_sample_rate 会在播放开始时按实际率纠正
        left.configure_highpass(HP_FREQ, 48_000.0, HP_Q);
        right.configure_highpass(HP_FREQ, 48_000.0, HP_Q);
        Self {
            enabled: AtomicBool::new(false),
            effective_backend: AtomicU8::new(0),
            filters: Mutex::new([left, right]),
        }
    }

    /// 配置开关与后端
    /// GPU/NPU 后端当前回退到 CPU,真正实现需 WebGPU compute 或 ONNX Runtime
    pub fn configure(&self, enabled: bool, backend: SuperResBackend) {
        self.enabled.store(enabled, Ordering::Relaxed);
        // 实际生效后端:CPU 始终可用,GPU/NPU 暂回退到 CPU
        let effective = match backend {
            SuperResBackend::Cpu => SuperResBackend::Cpu,
            SuperResBackend::Gpu | SuperResBackend::Npu => SuperResBackend::Cpu,
        };
        self.effective_backend.store(effective.to_u8(), Ordering::Relaxed);
        if !enabled {
            self.filters.lock().iter_mut().for_each(|f| f.reset());
        }
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
        let mut filters = self.filters.lock();
        filters[0].configure_highpass(HP_FREQ, sample_rate, HP_Q);
        filters[1].configure_highpass(HP_FREQ, sample_rate, HP_Q);
    }

    /// 重置滤波器状态(切歌时调用,避免上一首尾音残留)
    pub fn reset_state(&self) {
        let mut filters = self.filters.lock();
        filters[0].reset();
        filters[1].reset();
    }

    /// 处理交错立体声样本(原地修改)
    /// 关闭时直接返回,零开销;开启时按声道应用高通 + tanh 软饱和 + 二次谐波 + 混合
    pub fn process_interleaved_stereo(&self, samples: &mut [f32]) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let mut filters = self.filters.lock();
        let chunks = samples.chunks_exact_mut(2);
        for chunk in chunks {
            let left = chunk[0];
            let right = chunk[1];
            // 输入超限(已削波)时不激励,避免谐波堆积导致进一步削波
            if left.abs() < INPUT_LIMIT {
                let hp_left = filters[0].process(left);
                // tanh 软饱和:平滑过渡到饱和,奇次谐波丰富且听感自然
                let driven = hp_left * DRIVE;
                let wet = driven.tanh();
                // 二次谐波:全频段轻微偶次谐波,增加"温暖感"
                let h2_input = left * H2_DRIVE;
                let h2 = h2_input * h2_input * 0.5;
                chunk[0] = left + wet * WET_MIX + h2 * H2_MIX;
            }
            if right.abs() < INPUT_LIMIT {
                let hp_right = filters[1].process(right);
                let driven = hp_right * DRIVE;
                let wet = driven.tanh();
                let h2_input = right * H2_DRIVE;
                let h2 = h2_input * h2_input * 0.5;
                chunk[1] = right + wet * WET_MIX + h2 * H2_MIX;
            }
        }
    }
}

impl Default for SuperResolution {
    fn default() -> Self {
        Self::new()
    }
}
