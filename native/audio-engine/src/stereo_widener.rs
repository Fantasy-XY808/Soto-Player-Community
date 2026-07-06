//! 立体声展宽 DSP
//!
//! 三段式立体声增强：
//! 1. Mid-Side 处理：S = (L - R) / 2，按 width 倍数放大后还原
//!    - width = 1.0：原始立体声
//!    - width > 1.0：展宽（最大 2.0）
//!    - width < 1.0：收窄（最小 0.0 = 单声道）
//! 2. Cross-feed：左声道少量混入右声道（反之亦然），减少耳机听感的"洞穴效应"
//! 3. HAAS 效应：右声道延迟 8ms，利用优先效应制造空间感（默认关闭）
//! - bypass 时零开销

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use parking_lot::Mutex;

/// HAAS 延迟时长（秒）：8ms 是优先效应阈值，能产生明显空间感而不糊
const HAAS_DELAY_SECS: f32 = 0.008;
/// Cross-feed 默认混合量：20% 对侧声道混入，缓解耳机疲劳
const DEFAULT_CROSS_FEED: f32 = 0.2;

/// 立体声展宽参数
#[derive(Clone, Copy)]
pub struct StereoWidenerParams {
    /// 展宽系数，0.0 ~ 2.0，默认 1.4
    pub width: f32,
    /// Cross-feed 混合量，0.0 ~ 0.5，默认 0.2
    /// 左声道混入 20% 右声道（反之亦然），减少耳机听感的"洞穴效应"
    pub cross_feed: f32,
    /// HAAS 效应开关：true 时右声道延迟 8ms 制造空间感，默认 false
    pub haas_enabled: bool,
    /// A/B bypass：true 时跳过 DSP
    pub bypass: bool,
}

impl Default for StereoWidenerParams {
    fn default() -> Self {
        Self {
            width: 1.4,
            cross_feed: DEFAULT_CROSS_FEED,
            haas_enabled: false,
            bypass: false,
        }
    }
}

/// HAAS 延迟缓冲（环形）
struct HaasBuffer {
    /// 环形缓冲区
    buffer: Vec<f32>,
    /// 写入位置
    write_pos: usize,
}

impl HaasBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            buffer: vec![0.0; capacity.max(1)],
            write_pos: 0,
        }
    }

    fn resize(&mut self, capacity: usize) {
        let cap = capacity.max(1);
        self.buffer = vec![0.0; cap];
        self.write_pos = 0;
    }

    /// 推入样本，返回 cap 个样本前的旧值（延迟输出）
    #[inline]
    fn delay(&mut self, sample: f32) -> f32 {
        let delayed = self.buffer[self.write_pos];
        self.buffer[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.buffer.len();
        delayed
    }

    fn reset(&mut self) {
        for v in &mut self.buffer {
            *v = 0.0;
        }
        self.write_pos = 0;
    }
}

/// 立体声展宽处理器
pub struct StereoWidener {
    enabled: AtomicBool,
    sample_rate: AtomicU32,
    params: Mutex<StereoWidenerParams>,
    /// HAAS 延迟缓冲（仅右声道延迟，避免左右都延迟产生糊感）
    haas_buffer: Mutex<HaasBuffer>,
}

impl StereoWidener {
    pub fn new() -> Self {
        Self {
            enabled: AtomicBool::new(false),
            sample_rate: AtomicU32::new(48_000),
            params: Mutex::new(StereoWidenerParams::default()),
            haas_buffer: Mutex::new(HaasBuffer::new(Self::haas_capacity(48_000.0))),
        }
    }

    /// 按 8ms × sample_rate 计算 HAAS 缓冲容量
    fn haas_capacity(sample_rate: f32) -> usize {
        (HAAS_DELAY_SECS * sample_rate).round() as usize
    }

    pub fn configure(&self, enabled: bool, params: StereoWidenerParams) {
        self.enabled.store(enabled, Ordering::Relaxed);
        // HAAS 关闭或 bypass 时清空缓冲，避免下次启用时残留旧样本
        if !enabled || params.bypass || !params.haas_enabled {
            self.haas_buffer.lock().reset();
        }
        *self.params.lock() = params;
    }

    pub fn set_params(&self, params: StereoWidenerParams) {
        let mut p = self.params.lock();
        let old_haas = p.haas_enabled;
        let old_bypass = p.bypass;
        *p = params;
        let new_haas = p.haas_enabled;
        let new_bypass = p.bypass;
        drop(p);
        // HAAS 开关变化或切到 bypass 时清空缓冲，避免残留样本造成杂音
        if old_haas != new_haas || (old_bypass != new_bypass && new_bypass) {
            self.haas_buffer.lock().reset();
        }
    }

    pub fn params(&self) -> StereoWidenerParams {
        *self.params.lock()
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// 采样率变化时按新率重建 HAAS 缓冲容量，保持 8ms 延迟时长不变
    pub fn set_sample_rate(&self, sample_rate: f32) {
        let old_rate = self.sample_rate.swap(sample_rate as u32, Ordering::Relaxed);
        if (old_rate as f32 - sample_rate).abs() < 1.0 {
            return;
        }
        let capacity = Self::haas_capacity(sample_rate);
        self.haas_buffer.lock().resize(capacity);
    }

    pub fn reset_state(&self) {
        self.haas_buffer.lock().reset();
    }

    /// 处理交错立体声样本（原地修改）
    /// 顺序：Mid-Side 展宽 → Cross-feed → HAAS 延迟
    pub fn process_interleaved_stereo(&self, samples: &mut [f32]) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let p = *self.params.lock();
        if p.bypass {
            return;
        }
        let w = p.width;
        let cf = p.cross_feed;
        let haas_on = p.haas_enabled;
        let mut haas = if haas_on {
            Some(self.haas_buffer.lock())
        } else {
            None
        };
        for chunk in samples.chunks_exact_mut(2) {
            let l = chunk[0];
            let r = chunk[1];
            // 1. Mid-Side 展宽
            let mid = (l + r) * 0.5;
            let side = (l - r) * 0.5 * w;
            let mut l_widened = mid + side;
            let mut r_widened = mid - side;
            // 2. Cross-feed：左右声道互相混入少量对侧信号，缓解耳机疲劳
            if cf > 0.0 {
                let l_new = l_widened * (1.0 - cf) + r_widened * cf;
                let r_new = r_widened * (1.0 - cf) + l_widened * cf;
                l_widened = l_new;
                r_widened = r_new;
            }
            // 3. HAAS 效应：右声道延迟 8ms 制造空间感
            if let Some(buf) = haas.as_mut() {
                r_widened = buf.delay(r_widened);
            }
            chunk[0] = l_widened;
            chunk[1] = r_widened;
        }
    }
}

impl Default for StereoWidener {
    fn default() -> Self {
        Self::new()
    }
}
