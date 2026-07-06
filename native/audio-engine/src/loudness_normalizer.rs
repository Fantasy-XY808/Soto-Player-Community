//! 响度归一化 DSP（实时输出保护）
//!
//! 与 decoder.rs 内 LoudnessAnalyzer 不同：此处为输出侧的实时峰值/响度限制器，
//! 用于在多 DSP 串联后防止削波。基于滑动窗口 RMS 估计 + 一阶低通增益调整。
//!
//! 实现：
//! - 500ms 滑动窗口 RMS 估计（环形缓冲，O(1) 更新）
//! - 目标响度（默认 -10 LUFS，简化为 RMSdB；母带级响度，配合超分/低音增强后仍有冲击力）
//! - 增益上限 max_gain_db（默认 9dB），下限 -∞（静音）
//! - attack 50ms / release 200ms 平滑

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use parking_lot::Mutex;

/// 响度归一化参数
#[derive(Clone, Copy)]
pub struct LoudnessNormalizerParams {
    /// 目标响度（LUFS，简化为 RMS dB），默认 -10.0
    pub target_lufs: f32,
    /// 最大增益（dB），默认 9.0
    pub max_gain_db: f32,
    /// A/B bypass：true 时跳过 DSP
    pub bypass: bool,
}

impl Default for LoudnessNormalizerParams {
    fn default() -> Self {
        Self {
            target_lufs: -10.0,
            max_gain_db: 9.0,
            bypass: false,
        }
    }
}

/// 滑动窗口 RMS 状态（环形缓冲）
struct LoudnessWindow {
    /// 环形缓冲（平方样本值）
    rms_buffer: Vec<f32>,
    /// 写入位置
    rms_write_pos: usize,
    /// 窗口内平方和（O(1) 更新）
    rms_sum: f64,
    /// 当前应用增益（线性，用于平滑过渡）
    current_gain: f32,
}

impl LoudnessWindow {
    fn new(capacity: usize) -> Self {
        Self {
            rms_buffer: vec![0.0; capacity],
            rms_write_pos: 0,
            rms_sum: 0.0,
            current_gain: 1.0,
        }
    }

    fn reset(&mut self) {
        for v in &mut self.rms_buffer {
            *v = 0.0;
        }
        self.rms_write_pos = 0;
        self.rms_sum = 0.0;
        self.current_gain = 1.0;
    }

    #[inline]
    fn push(&mut self, square: f32) {
        let old = self.rms_buffer[self.rms_write_pos];
        self.rms_buffer[self.rms_write_pos] = square;
        self.rms_sum = self.rms_sum - old as f64 + square as f64;
        self.rms_write_pos = (self.rms_write_pos + 1) % self.rms_buffer.len();
    }

    fn rms(&self) -> f32 {
        if self.rms_buffer.is_empty() {
            return 0.0;
        }
        (self.rms_sum.max(0.0) / self.rms_buffer.len() as f64).sqrt() as f32
    }
}

/// 响度归一化处理器
pub struct LoudnessNormalizer {
    enabled: AtomicBool,
    sample_rate: AtomicU32,
    params: Mutex<LoudnessNormalizerParams>,
    window: Mutex<LoudnessWindow>,
}

impl LoudnessNormalizer {
    pub fn new() -> Self {
        // 默认 500ms × 48kHz × 2 声道 = 48000 样本
        let default_capacity = (0.5 * 48000.0 * 2.0) as usize;
        Self {
            enabled: AtomicBool::new(false),
            sample_rate: AtomicU32::new(48_000),
            params: Mutex::new(LoudnessNormalizerParams::default()),
            window: Mutex::new(LoudnessWindow::new(default_capacity)),
        }
    }

    pub fn configure(&self, enabled: bool, params: LoudnessNormalizerParams) {
        self.enabled.store(enabled, Ordering::Relaxed);
        *self.params.lock() = params;
        if !enabled {
            self.window.lock().reset();
        }
    }

    pub fn set_params(&self, params: LoudnessNormalizerParams) {
        let mut p = self.params.lock();
        let old_bypass = p.bypass;
        *p = params;
        let new_bypass = p.bypass;
        drop(p);
        // 切到 bypass 时清空窗口，下次开启时从 1.0 增益重新开始
        if new_bypass && !old_bypass {
            self.window.lock().reset();
        }
    }

    pub fn params(&self) -> LoudnessNormalizerParams {
        *self.params.lock()
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn set_sample_rate(&self, sample_rate: f32) {
        let old_rate = self.sample_rate.swap(sample_rate as u32, Ordering::Relaxed);
        if (old_rate as f32 - sample_rate).abs() < 1.0 {
            return;
        }
        // 采样率变化时按新率重建窗口容量
        let capacity = (0.5 * sample_rate as f64 * 2.0) as usize;
        let mut window = self.window.lock();
        *window = LoudnessWindow::new(capacity);
    }

    pub fn reset_state(&self) {
        self.window.lock().reset();
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

        // 平滑时间常数：attack 50ms，release 200ms
        // 系数 = exp(-1 / (rate * time))
        let rate = self.sample_rate.load(Ordering::Relaxed) as f32;
        let attack_coef = (-1.0 / (rate * 0.05)).exp();
        let release_coef = (-1.0 / (rate * 0.2)).exp();

        let target_rms = 10.0_f32.powf(p.target_lufs / 20.0);
        let max_gain = 10.0_f32.powf(p.max_gain_db / 20.0);

        let mut window = self.window.lock();
        for chunk in samples.chunks_exact_mut(2) {
            let l = chunk[0];
            let r = chunk[1];
            // 推入平方样本（左右声道平均）
            let square = (l * l + r * r) * 0.5;
            window.push(square);

            // 计算目标增益：target_rms / current_rms
            let current_rms = window.rms().max(1e-6);
            let target_gain = (target_rms / current_rms).clamp(0.0, max_gain);

            // 平滑：增益变大用 release（更慢），增益变小用 attack（更快）
            // 这里 attack/release 命名按音频惯例：attack = 增益减小（限制），release = 增益增大（恢复）
            let coef = if target_gain < window.current_gain {
                attack_coef
            } else {
                release_coef
            };
            window.current_gain = window.current_gain + (target_gain - window.current_gain) * (1.0 - coef);

            chunk[0] = l * window.current_gain;
            chunk[1] = r * window.current_gain;
        }
    }
}

impl Default for LoudnessNormalizer {
    fn default() -> Self {
        Self::new()
    }
}
