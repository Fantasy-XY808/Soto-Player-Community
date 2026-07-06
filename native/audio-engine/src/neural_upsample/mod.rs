//! 神经网络上采样 DSP
//!
//! 策略：框架就绪 + 算法兜底
//! - 启用且加载到 ONNX 模型时：调用 model.infer() 占位推理（线性插值 + 高频补偿），
//!   在原信号基础上锐化已有的高频过渡，与原信号混合
//! - 启用但未加载到模型时：带宽外推兜底（LP 提取低频 → tanh 软饱和生成新谐波 →
//!   HP 保留新生成的高频 → 与原信号混合），听感上补充缺失的高频细节
//! - 关闭 / bypass 时：零开销 early return
//!
//! 模型路径：用户通过 IPC 传入，由 IPC handler 读取 `{userData}/app-data/models/`
//! 目录下的 `super_res.onnx`。加载失败（文件不存在 / ort 初始化失败）时回退到带宽外推，
//! effective_backend 反映实际生效后端，前端可据此显示提示。
//!
//! 输出长度与输入相同（原地修改），不改变后续 DSP 与 sink 的采样率。

pub mod model_loader;

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::OnceLock;

use parking_lot::Mutex;

use crate::neural_upsample::model_loader::NeuralModel;
use crate::super_resolution::BiquadState;

/// 神经网络上采样后端
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NeuralBackend {
    /// 算法兜底（无模型时带宽外推）
    Fallback,
    /// ONNX Runtime 推理
    Onnx,
}

impl NeuralBackend {
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Onnx,
            _ => Self::Fallback,
        }
    }

    pub fn to_u8(self) -> u8 {
        match self {
            Self::Fallback => 0,
            Self::Onnx => 1,
        }
    }
}

/// 神经网络上采样参数（可配置，前端可热更新）
#[derive(Clone, Copy)]
pub struct NeuralUpsampleParams {
    /// 输入增益（dB），默认 0
    pub input_gain_db: f32,
    /// 湿信号混合比例，默认 0.5
    pub wet_mix: f32,
    /// A/B bypass：true 时跳过 DSP
    pub bypass: bool,
}

impl Default for NeuralUpsampleParams {
    fn default() -> Self {
        Self {
            input_gain_db: 0.0,
            wet_mix: 0.5,
            bypass: false,
        }
    }
}

/// 包络提取截止频率（Hz）：低于此值的成分用于生成新谐波
const ENVELOPE_FREQ: f32 = 1000.0;
/// 高频保留截止频率（Hz）：饱和后只保留高于此值的新生成成分
const HARMONIC_FREQ: f32 = 6000.0;
/// 软饱和驱动强度（无单位倍数）
const HARMONIC_DRIVE: f32 = 2.0;

/// 单声道带宽外推滤波器组（LP 提取低频源 + HP 保留新生成的高频）
#[derive(Clone, Copy, Default)]
struct ChannelFilter {
    lp: BiquadState,
    hp: BiquadState,
}

impl ChannelFilter {
    fn passthrough() -> Self {
        Self {
            lp: BiquadState::passthrough(),
            hp: BiquadState::passthrough(),
        }
    }

    /// 按采样率重建 LP + HP 系数
    fn configure(&mut self, sample_rate: f32) {
        self.lp.configure_lowpass(ENVELOPE_FREQ, sample_rate, 0.7);
        self.hp.configure_highpass(HARMONIC_FREQ, sample_rate, 0.7);
    }

    fn reset(&mut self) {
        self.lp.reset();
        self.hp.reset();
    }
}

/// 神经网络上采样处理器
pub struct NeuralUpsample {
    /// 是否启用（false = 直通）
    enabled: AtomicBool,
    /// 实际生效后端（Onnx 后端仅在模型存在时才生效，否则回退到 Fallback）
    effective_backend: AtomicU8,
    /// 可配置参数
    params: Mutex<NeuralUpsampleParams>,
    /// 已加载的 ONNX 模型（None = 未加载，走 fallback）
    /// OnceLock 保证模型只加载一次（首次成功后不再重试，避免每次 process 都尝试加载）
    model: OnceLock<Option<NeuralModel>>,
    /// 模型路径（用于 UI 显示已加载路径）
    model_path: Mutex<Option<String>>,
    /// 带宽外推滤波器状态（左右声道独立）
    filters: Mutex<[ChannelFilter; 2]>,
}

impl NeuralUpsample {
    pub fn new() -> Self {
        let mut left = ChannelFilter::passthrough();
        let mut right = ChannelFilter::passthrough();
        // 默认 48kHz 配置,set_sample_rate 会在播放开始时按实际率纠正
        left.configure(48_000.0);
        right.configure(48_000.0);
        Self {
            enabled: AtomicBool::new(false),
            effective_backend: AtomicU8::new(NeuralBackend::Fallback.to_u8()),
            params: Mutex::new(NeuralUpsampleParams::default()),
            model: OnceLock::new(),
            model_path: Mutex::new(None),
            filters: Mutex::new([left, right]),
        }
    }

    /// 配置开关 + 后端 + 参数
    /// Onnx 后端仅在模型已加载时才生效，否则回退到 Fallback
    pub fn configure(&self, enabled: bool, backend: NeuralBackend, params: NeuralUpsampleParams) {
        self.enabled.store(enabled, Ordering::Relaxed);
        let effective = if matches!(backend, NeuralBackend::Onnx) && self.model.get().is_some() {
            NeuralBackend::Onnx
        } else {
            NeuralBackend::Fallback
        };
        self.effective_backend
            .store(effective.to_u8(), Ordering::Relaxed);
        *self.params.lock() = params;
        // 关闭或切到 bypass 时清空滤波器状态，避免下次启用时残留尾音
        if !enabled || params.bypass {
            self.filters.lock().iter_mut().for_each(|f| f.reset());
        }
    }

    /// 仅更新参数（不改变 enabled / backend）
    pub fn set_params(&self, params: NeuralUpsampleParams) {
        let mut p = self.params.lock();
        let bypass_changed = p.bypass != params.bypass;
        *p = params;
        drop(p);
        // 切到 bypass 时清空滤波器状态
        if bypass_changed && params.bypass {
            self.filters.lock().iter_mut().for_each(|f| f.reset());
        }
    }

    /// 取当前参数副本
    pub fn params(&self) -> NeuralUpsampleParams {
        *self.params.lock()
    }

    /// 暴露当前生效后端（供 UI 显示是否回退）
    pub fn effective_backend(&self) -> NeuralBackend {
        NeuralBackend::from_u8(self.effective_backend.load(Ordering::Relaxed))
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// 尝试加载 ONNX 模型
    /// 路径不存在 / ort 加载失败时返回 Err，effective_backend 仍为 Fallback
    /// 加载成功后 OnceLock 锁定，后续调用直接返回首次结果
    pub fn try_load_model(&self, path: &str) -> Result<(), String> {
        if self.model.get().is_some() {
            return Ok(());
        }
        match model_loader::load_model(path) {
            Ok(model) => {
                let _ = self.model.set(Some(model));
                *self.model_path.lock() = Some(path.to_string());
                tracing::info!(path, "神经网络上采样模型已加载");
                Ok(())
            }
            Err(e) => {
                let _ = self.model.set(None);
                tracing::warn!(path, "神经网络上采样模型加载失败: {e}");
                Err(e)
            }
        }
    }

    /// 取已加载模型路径（None = 未加载）
    pub fn model_path(&self) -> Option<String> {
        self.model_path.lock().clone()
    }

    /// 重置内部状态（切歌时调用）
    /// 清空带宽外推滤波器的 z1/z2 状态，避免上一首尾音残留
    pub fn reset_state(&self) {
        self.filters.lock().iter_mut().for_each(|f| f.reset());
    }

    /// 按当前采样率重建内部系数（load/seek 时由 player 调用）
    /// 模型推理不依赖播放采样率；带宽外推兜底需要按采样率重建 LP/HP 系数
    pub fn set_sample_rate(&self, sample_rate: f32) {
        let mut filters = self.filters.lock();
        filters[0].configure(sample_rate);
        filters[1].configure(sample_rate);
    }

    /// 处理交错立体声样本（原地修改）
    /// - 关闭 / bypass 时：直通，零开销
    /// - 加载到 ONNX 模型时：调用模型推理（框架阶段为占位调用）
    /// - 未加载模型时：带宽外推兜底，LP 提低频 → tanh 谐波 → HP 保留新生成高频 → 混合
    pub fn process_interleaved_stereo(&self, samples: &mut [f32]) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let p = *self.params.lock();
        if p.bypass {
            return;
        }
        let Some(Some(model)) = self.model.get() else {
            // 无模型：带宽外推兜底
            let wet_mix = p.wet_mix;
            let input_gain = if p.input_gain_db.abs() > f32::EPSILON {
                10.0_f32.powf(p.input_gain_db / 20.0)
            } else {
                1.0
            };
            let mut filters = self.filters.lock();
            for chunk in samples.chunks_exact_mut(2) {
                let left = chunk[0] * input_gain;
                let right = chunk[1] * input_gain;
                chunk[0] = Self::process_sample_fallback(left, &mut filters[0], wet_mix);
                chunk[1] = Self::process_sample_fallback(right, &mut filters[1], wet_mix);
            }
            return;
        };
        // 模型推理：当前为占位实现（线性插值 + 高频补偿），原地修改 samples
        model.infer(samples);
    }

    /// 带宽外推单样本处理：LP 提低频 → tanh 软饱和生成新谐波 → HP 保留新生成高频 → 混合
    #[inline]
    fn process_sample_fallback(input: f32, filter: &mut ChannelFilter, wet_mix: f32) -> f32 {
        let lp_out = filter.lp.process(input);
        let harmonics = (lp_out * HARMONIC_DRIVE).tanh();
        let new_hf = filter.hp.process(harmonics);
        input + new_hf * wet_mix
    }
}

impl Default for NeuralUpsample {
    fn default() -> Self {
        Self::new()
    }
}
