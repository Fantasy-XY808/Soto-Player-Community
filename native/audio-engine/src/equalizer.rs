//! 参数化均衡器：每频段可调频率 / Q / 增益 / 滤波器类型。
//!
//! 滤波器系数采用 RBJ Audio EQ Cookbook 公式，
//! 实现形式为 Direct Form II Transposed（数值稳定）。
//! 每条频段、每个声道独立保留状态，立体声共享系数（左右声道处理一致）。
//! 环绕声采用 Mid/Side 处理，增益 Side 通道扩展立体声场。
//!
//! 同时提供：
//! - 频响曲线计算（供 UI 绘制）
//! - 输入/输出电平 RMS 采样（供电平表显示）
//! - A/B bypass 切换

use std::f32::consts::PI;

/// 最大频段数（避免 Vec 在热路径上分配）
pub const EQ_MAX_BANDS: usize = 32;

/// 声道数（仅支持立体声）
pub const EQ_CHANNEL_COUNT: usize = 2;

/// 每段增益限制（dB）
const BAND_GAIN_LIMIT_DB: f32 = 15.0;

/// 前级增益限制（dB）
const PREAMP_LIMIT_DB: f32 = 12.0;

/// 低/高音增益限制（dB）
const SHELF_GAIN_LIMIT_DB: f32 = 12.0;

/// 环绕声增益限制（倍数）。Side 通道增益过大易让 L+R 峰值叠加饱和，
/// 1.5 是听感与安全的平衡点：足以扩展立体声场，又不至于把信号推到削波区。
const SURROUND_GAIN_LIMIT: f32 = 1.5;

/// 频率范围（Hz）
pub const EQ_MIN_FREQ: f32 = 20.0;
pub const EQ_MAX_FREQ: f32 = 20000.0;

/// Q 值范围
pub const EQ_MIN_Q: f32 = 0.1;
pub const EQ_MAX_Q: f32 = 24.0;

/// dB → 线性增益
fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// 一阶低通系数：alpha = 1 - exp(-1 / (sr * tau))。
/// tau 越大过渡越缓；48kHz / 20ms 下约 0.0875，每样本逼近目标值 8.75%。
fn compute_smooth_coef(sample_rate: f32, tau: f32) -> f32 {
    let safe_sr = sample_rate.max(1.0);
    let safe_tau = tau.max(1e-4);
    1.0 - (-1.0 / (safe_sr * safe_tau)).exp()
}

/// 滤波器类型
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FilterType {
    /// 通带（无滤波）
    Passthrough,
    /// 钟形滤波器（指定频率处峰值增益）
    Peaking,
    /// 低频架桥（指定频率以下整体增益/衰减）
    LowShelf,
    /// 高频架桥（指定频率以上整体增益/衰减）
    HighShelf,
    /// 低通（指定频率以上衰减）
    LowPass,
    /// 高通（指定频率以下衰减）
    HighPass,
    /// 陷波（指定频率处衰减）
    Notch,
    /// 带通（仅指定频率附近通过）
    BandPass,
}

impl FilterType {
    pub fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Peaking,
            2 => Self::LowShelf,
            3 => Self::HighShelf,
            4 => Self::LowPass,
            5 => Self::HighPass,
            6 => Self::Notch,
            7 => Self::BandPass,
            _ => Self::Passthrough,
        }
    }

    pub fn to_u8(self) -> u8 {
        match self {
            Self::Passthrough => 0,
            Self::Peaking => 1,
            Self::LowShelf => 2,
            Self::HighShelf => 3,
            Self::LowPass => 4,
            Self::HighPass => 5,
            Self::Notch => 6,
            Self::BandPass => 7,
        }
    }
}

/// 单个频段参数（无状态）
#[derive(Clone, Copy, Debug)]
pub struct BandParams {
    pub freq: f32,
    pub q: f32,
    pub gain_db: f32,
    pub filter_type: FilterType,
}

impl Default for BandParams {
    fn default() -> Self {
        Self {
            freq: 1000.0,
            q: 1.4,
            gain_db: 0.0,
            filter_type: FilterType::Peaking,
        }
    }
}

/// 单个 biquad 滤波器（Direct Form II Transposed）
///
/// 系数平滑：target_* 持有最新参数计算出的系数，b0/b1/b2/a1/a2 在 process_sample 中
/// 按 smooth_coef 一阶低通向 target 逼近，避免滑块拖动时系数突变引发状态不连续爆音
#[derive(Clone, Copy, Debug)]
struct BiquadFilter {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    target_b0: f32,
    target_b1: f32,
    target_b2: f32,
    target_a1: f32,
    target_a2: f32,
    smooth_coef: f32,
    z1: f32,
    z2: f32,
}

impl BiquadFilter {
    fn passthrough() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            target_b0: 1.0,
            target_b1: 0.0,
            target_b2: 0.0,
            target_a1: 0.0,
            target_a2: 0.0,
            smooth_coef: 0.1,
            z1: 0.0,
            z2: 0.0,
        }
    }

    /// 按 RBJ Cookbook 公式根据 filter_type 计算系数，写入 target，
    /// 当前系数由 process_sample 平滑过渡，避免突变引发电流声
    fn set_by_type(
        &mut self,
        filter_type: FilterType,
        freq: f32,
        sample_rate: f32,
        q: f32,
        gain_db: f32,
    ) {
        // Passthrough 或零增益（仅 peaking/shelf 模式可省略）
        if filter_type == FilterType::Passthrough {
            self.target_b0 = 1.0;
            self.target_b1 = 0.0;
            self.target_b2 = 0.0;
            self.target_a1 = 0.0;
            self.target_a2 = 0.0;
            return;
        }
        if matches!(
            filter_type,
            FilterType::Peaking | FilterType::LowShelf | FilterType::HighShelf
        ) && gain_db.abs() < 1e-3
        {
            self.target_b0 = 1.0;
            self.target_b1 = 0.0;
            self.target_b2 = 0.0;
            self.target_a1 = 0.0;
            self.target_a2 = 0.0;
            return;
        }

        let omega = 2.0 * PI * freq / sample_rate;
        let sin_omega = omega.sin();
        let cos_omega = omega.cos();
        let alpha = sin_omega / (2.0 * q.max(EQ_MIN_Q));

        let (b0, b1, b2, a0, a1, a2) = match filter_type {
            FilterType::Peaking => {
                let amp = 10.0_f32.powf(gain_db / 40.0);
                (
                    1.0 + alpha * amp,
                    -2.0 * cos_omega,
                    1.0 - alpha * amp,
                    1.0 + alpha / amp,
                    -2.0 * cos_omega,
                    1.0 - alpha / amp,
                )
            }
            FilterType::LowShelf => {
                let amp = 10.0_f32.powf(gain_db / 40.0);
                let sqrt_a = amp.sqrt();
                (
                    amp * ((amp + 1.0) - (amp - 1.0) * cos_omega + 2.0 * sqrt_a * alpha),
                    2.0 * amp * ((amp - 1.0) - (amp + 1.0) * cos_omega),
                    amp * ((amp + 1.0) - (amp - 1.0) * cos_omega - 2.0 * sqrt_a * alpha),
                    (amp + 1.0) + (amp - 1.0) * cos_omega + 2.0 * sqrt_a * alpha,
                    -2.0 * ((amp - 1.0) + (amp + 1.0) * cos_omega),
                    (amp + 1.0) + (amp - 1.0) * cos_omega - 2.0 * sqrt_a * alpha,
                )
            }
            FilterType::HighShelf => {
                let amp = 10.0_f32.powf(gain_db / 40.0);
                let sqrt_a = amp.sqrt();
                (
                    amp * ((amp + 1.0) + (amp - 1.0) * cos_omega + 2.0 * sqrt_a * alpha),
                    -2.0 * amp * ((amp - 1.0) + (amp + 1.0) * cos_omega),
                    amp * ((amp + 1.0) + (amp - 1.0) * cos_omega - 2.0 * sqrt_a * alpha),
                    (amp + 1.0) - (amp - 1.0) * cos_omega + 2.0 * sqrt_a * alpha,
                    2.0 * ((amp - 1.0) - (amp + 1.0) * cos_omega),
                    (amp + 1.0) - (amp - 1.0) * cos_omega - 2.0 * sqrt_a * alpha,
                )
            }
            FilterType::LowPass => (
                (1.0 - cos_omega) / 2.0,
                1.0 - cos_omega,
                (1.0 - cos_omega) / 2.0,
                1.0 + alpha,
                -2.0 * cos_omega,
                1.0 - alpha,
            ),
            FilterType::HighPass => (
                (1.0 + cos_omega) / 2.0,
                -(1.0 + cos_omega),
                (1.0 + cos_omega) / 2.0,
                1.0 + alpha,
                -2.0 * cos_omega,
                1.0 - alpha,
            ),
            FilterType::Notch => (1.0, -2.0 * cos_omega, 1.0, 1.0 + alpha, -2.0 * cos_omega, 1.0 - alpha),
            FilterType::BandPass => (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos_omega, 1.0 - alpha),
            FilterType::Passthrough => (1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        };

        let inv_a0 = 1.0 / a0;
        self.target_b0 = b0 * inv_a0;
        self.target_b1 = b1 * inv_a0;
        self.target_b2 = b2 * inv_a0;
        self.target_a1 = a1 * inv_a0;
        self.target_a2 = a2 * inv_a0;
    }

    /// 计算频响曲线（复数传递函数 H(e^jω) 的幅度，dB）
    /// 公式来自 RBJ Cookbook：|H(z)| = sqrt((b0 + b1*cos + b2*cos2)^2 + (b1*sin + b2*sin2)^2) /
    ///                            sqrt((1 + a1*cos + a2*cos2)^2 + (a1*sin + a2*sin2)^2)
    fn magnitude_db(&self, freq: f32, sample_rate: f32) -> f32 {
        let omega = 2.0 * PI * freq / sample_rate;
        let cos1 = omega.cos();
        let sin1 = omega.sin();
        let cos2 = (2.0 * omega).cos();
        let sin2 = (2.0 * omega).sin();

        let num_re = self.b0 + self.b1 * cos1 + self.b2 * cos2;
        let num_im = self.b1 * sin1 + self.b2 * sin2;
        let den_re = 1.0 + self.a1 * cos1 + self.a2 * cos2;
        let den_im = self.a1 * sin1 + self.a2 * sin2;

        let num_sq = num_re * num_re + num_im * num_im;
        let den_sq = den_re * den_re + den_im * den_im;
        let ratio = (num_sq / den_sq.max(1e-12)).sqrt();
        20.0 * ratio.log10()
    }

    #[inline]
    fn process_sample(&mut self, x: f32) -> f32 {
        // 系数平滑：每样本向 target 逼近一次，消除滑块拖动时的状态不连续爆音
        let alpha = self.smooth_coef;
        self.b0 += (self.target_b0 - self.b0) * alpha;
        self.b1 += (self.target_b1 - self.b1) * alpha;
        self.b2 += (self.target_b2 - self.b2) * alpha;
        self.a1 += (self.target_a1 - self.a1) * alpha;
        self.a2 += (self.target_a2 - self.a2) * alpha;
        // Direct Form II Transposed
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }

    fn reset_state(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
        // 切歌时把当前系数立即对齐 target，避免新曲沿用旧系数导致开头的瞬态音色偏差
        self.b0 = self.target_b0;
        self.b1 = self.target_b1;
        self.b2 = self.target_b2;
        self.a1 = self.target_a1;
        self.a2 = self.target_a2;
    }
}

/// 单频段（含参数与每个声道的滤波器状态）
struct Band {
    params: BandParams,
    filters: [BiquadFilter; EQ_CHANNEL_COUNT],
}

/// RMS 电平表（滑动窗口，O(1) 增量更新）
struct LevelMeter {
    /// 平方和缓冲（环形）
    squares: [f32; LevelMeter::WINDOW],
    /// 写入位置
    pos: usize,
    /// 是否已填满
    filled: bool,
    /// 当前窗口内平方和（增量维护，避免每样本 O(N) 重算）
    running_sum: f32,
    /// 当前 RMS（缓存，由 running_sum 直接算出）
    rms_cached: f32,
}

impl LevelMeter {
    const WINDOW: usize = 512;

    fn new() -> Self {
        Self {
            squares: [0.0; Self::WINDOW],
            pos: 0,
            filled: false,
            running_sum: 0.0,
            rms_cached: 0.0,
        }
    }

    #[inline]
    fn push(&mut self, sample: f32) {
        let sq = sample * sample;
        // 增量更新：减掉即将被覆盖的旧值，加上新值，O(1)
        let old = self.squares[self.pos];
        self.squares[self.pos] = sq;
        self.running_sum += sq - old;
        self.pos = (self.pos + 1) % Self::WINDOW;
        if self.pos == 0 {
            self.filled = true;
        }
        let len = if self.filled { Self::WINDOW } else { self.pos };
        // running_sum 在浮点累加下可能产生微小误差，配合 max(1e-9) 防 sqrt(0)
        let sum = self.running_sum.max(0.0);
        self.rms_cached = (sum / len.max(1) as f32).sqrt();
    }

    fn reset(&mut self) {
        self.squares = [0.0; Self::WINDOW];
        self.pos = 0;
        self.filled = false;
        self.running_sum = 0.0;
        self.rms_cached = 0.0;
    }

    fn rms(&self) -> f32 {
        self.rms_cached
    }
}

/// 参数化均衡器：可变频段数 + 低/高音架桥 + 环绕声 + 电平表 + bypass
pub struct Equalizer {
    /// 频段列表（最多 EQ_MAX_BANDS 个）
    bands: Vec<Band>,
    /// [声道] 低音架桥（bass boost）
    bass_shelf: [BiquadFilter; EQ_CHANNEL_COUNT],
    /// [声道] 高音架桥（treble boost）
    treble_shelf: [BiquadFilter; EQ_CHANNEL_COUNT],
    sample_rate: f32,
    bass_gain_db: f32,
    treble_gain_db: f32,
    /// 当前生效的前级增益（线性）。每样本向 target 插值，避免参数跳跃爆音。
    preamp_linear: f32,
    /// 前级增益目标值（set_preamp_db 时更新，process 路径平滑追踪它）
    preamp_target: f32,
    /// 环绕声 Side 通道增益（1.0 = 原始，>1 扩展立体声场）。当前生效值。
    surround_gain: f32,
    /// 环绕声目标值
    surround_target: f32,
    /// 一阶低通系数（按 20ms 时间常数重算），用于 preamp/surround 平滑
    smooth_coef: f32,
    enabled: bool,
    /// A/B bypass：true 时跳过所有滤波器（用于对比效果）
    bypass: bool,
    /// 输入电平表（左/右声道 RMS）
    input_meters: [LevelMeter; EQ_CHANNEL_COUNT],
    /// 输出电平表（左/右声道 RMS）
    output_meters: [LevelMeter; EQ_CHANNEL_COUNT],
}

impl Equalizer {
    /// 参数平滑时间常数（秒）。20ms 在听感上接近"瞬时"但能消除样本级阶跃爆音。
    const SMOOTH_TAU: f32 = 0.02;

    pub fn new(sample_rate: u32) -> Self {
        let rate = sample_rate as f32;
        let mut eq = Self {
            bands: Vec::new(),
            bass_shelf: [BiquadFilter::passthrough(); EQ_CHANNEL_COUNT],
            treble_shelf: [BiquadFilter::passthrough(); EQ_CHANNEL_COUNT],
            sample_rate: rate,
            bass_gain_db: 0.0,
            treble_gain_db: 0.0,
            preamp_linear: 1.0,
            preamp_target: 1.0,
            surround_gain: 1.0,
            surround_target: 1.0,
            smooth_coef: compute_smooth_coef(rate, Self::SMOOTH_TAU),
            enabled: false,
            bypass: false,
            input_meters: [LevelMeter::new(), LevelMeter::new()],
            output_meters: [LevelMeter::new(), LevelMeter::new()],
        };
        eq.sync_biquad_smooth_coef();
        eq
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }

    pub fn set_bypass(&mut self, bypass: bool) {
        self.bypass = bypass;
    }

    pub fn bypass(&self) -> bool {
        self.bypass
    }

    /// 更新采样率（输出设备切换导致播放采样率变化时调用），重算所有滤波器系数
    pub fn set_sample_rate(&mut self, sample_rate: u32) {
        let rate = sample_rate as f32;
        if (self.sample_rate - rate).abs() < f32::EPSILON {
            return;
        }
        self.sample_rate = rate;
        self.smooth_coef = compute_smooth_coef(rate, Self::SMOOTH_TAU);
        self.recompute_coefficients();
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// 取当前频段数
    pub fn band_count(&self) -> usize {
        self.bands.len()
    }

    /// 取所有频段参数
    pub fn band_params(&self) -> Vec<BandParams> {
        self.bands.iter().map(|b| b.params).collect()
    }

    /// 设置频段数量；新增频段使用默认参数（1000Hz, Q=1.4, 0dB, Peaking）
    pub fn set_band_count(&mut self, count: usize) {
        let count = count.min(EQ_MAX_BANDS);
        if count == self.bands.len() {
            return;
        }
        if count < self.bands.len() {
            self.bands.truncate(count);
        } else {
            while self.bands.len() < count {
                self.bands.push(Band {
                    params: BandParams::default(),
                    filters: [BiquadFilter::passthrough(); EQ_CHANNEL_COUNT],
                });
            }
        }
    }

    /// 更新指定频段参数；index 超界时返回 false
    pub fn set_band_params(
        &mut self,
        index: usize,
        freq: f32,
        q: f32,
        gain_db: f32,
        filter_type: FilterType,
    ) -> bool {
        if index >= self.bands.len() {
            return false;
        }
        let band = &mut self.bands[index];
        band.params.freq = freq.clamp(EQ_MIN_FREQ, EQ_MAX_FREQ);
        band.params.q = q.clamp(EQ_MIN_Q, EQ_MAX_Q);
        band.params.gain_db = if gain_db.is_finite() {
            gain_db.clamp(-BAND_GAIN_LIMIT_DB, BAND_GAIN_LIMIT_DB)
        } else {
            0.0
        };
        band.params.filter_type = filter_type;
        for filter in band.filters.iter_mut() {
            filter.set_by_type(filter_type, band.params.freq, self.sample_rate, band.params.q, band.params.gain_db);
        }
        true
    }

    /// 兼容旧接口：批量更新各频段增益（dB），长度按短端截取
    pub fn set_band_gains(&mut self, gains_db: &[f32]) {
        for (i, gain) in gains_db.iter().take(self.bands.len()).enumerate() {
            let v = if gain.is_finite() { *gain } else { 0.0 };
            let clamped = v.clamp(-BAND_GAIN_LIMIT_DB, BAND_GAIN_LIMIT_DB);
            let band = &mut self.bands[i];
            band.params.gain_db = clamped;
            for filter in band.filters.iter_mut() {
                filter.set_by_type(
                    band.params.filter_type,
                    band.params.freq,
                    self.sample_rate,
                    band.params.q,
                    clamped,
                );
            }
        }
    }

    /// 取所有频段增益
    pub fn band_gains_db(&self) -> Vec<f32> {
        self.bands.iter().map(|b| b.params.gain_db).collect()
    }

    /// 设置低音增益（dB），正值增强低频
    pub fn set_bass_gain_db(&mut self, db: f32) {
        let v = if db.is_finite() { db } else { 0.0 };
        self.bass_gain_db = v.clamp(-SHELF_GAIN_LIMIT_DB, SHELF_GAIN_LIMIT_DB);
        self.recompute_shelves();
    }

    pub fn bass_gain_db(&self) -> f32 {
        self.bass_gain_db
    }

    /// 设置高音增益（dB），正值增强高频
    pub fn set_treble_gain_db(&mut self, db: f32) {
        let v = if db.is_finite() { db } else { 0.0 };
        self.treble_gain_db = v.clamp(-SHELF_GAIN_LIMIT_DB, SHELF_GAIN_LIMIT_DB);
        self.recompute_shelves();
    }

    pub fn treble_gain_db(&self) -> f32 {
        self.treble_gain_db
    }

    /// 非有限值按 0dB 处理，避免 NaN 污染 preamp_linear。
    /// 仅写 target，process 路径每样本向 preamp_linear 平滑过渡。
    pub fn set_preamp_db(&mut self, db: f32) {
        let v = if db.is_finite() { db } else { 0.0 };
        let clamped = v.clamp(-PREAMP_LIMIT_DB, PREAMP_LIMIT_DB);
        self.preamp_target = db_to_linear(clamped);
    }

    pub fn preamp_db(&self) -> f32 {
        20.0 * self.preamp_linear.log10()
    }

    /// 设置环绕声增益（1.0 = 原始，>1 扩展立体声场，<1 收窄）。
    /// 仅写 target，process 路径每样本向 surround_gain 平滑过渡。
    pub fn set_surround_gain(&mut self, gain: f32) {
        let v = if gain.is_finite() { gain } else { 1.0 };
        self.surround_target = v.clamp(0.0, SURROUND_GAIN_LIMIT);
    }

    pub fn surround_gain(&self) -> f32 {
        self.surround_gain
    }

    /// 清空滤波器状态（切歌、seek 时调用，避免上一首尾音残留导致瞬态不稳定）
    pub fn reset_state(&mut self) {
        for band in self.bands.iter_mut() {
            for filter in band.filters.iter_mut() {
                filter.reset_state();
            }
        }
        for filter in self.bass_shelf.iter_mut() {
            filter.reset_state();
        }
        for filter in self.treble_shelf.iter_mut() {
            filter.reset_state();
        }
        for meter in self.input_meters.iter_mut() {
            meter.reset();
        }
        for meter in self.output_meters.iter_mut() {
            meter.reset();
        }
    }

    /// 计算所有频段在指定频率列表上的总频响（dB）
    /// 仅累加每段 magnitude_db（线性叠加 ≈ 多段串接的对数叠加，对绘图足够准确）
    pub fn frequency_response_db(&self, freqs: &[f32]) -> Vec<f32> {
        let preamp_db = 20.0 * self.preamp_linear.log10();
        freqs
            .iter()
            .map(|&freq| {
                let mut sum = preamp_db;
                for band in self.bands.iter() {
                    // 所有声道共享系数，取第 0 声道
                    sum += band.filters[0].magnitude_db(freq, self.sample_rate);
                }
                sum += self.bass_shelf[0].magnitude_db(freq, self.sample_rate);
                sum += self.treble_shelf[0].magnitude_db(freq, self.sample_rate);
                sum
            })
            .collect()
    }

    /// 取输入电平 RMS（0~1 线性）
    pub fn input_levels(&self) -> [f32; EQ_CHANNEL_COUNT] {
        [self.input_meters[0].rms(), self.input_meters[1].rms()]
    }

    /// 取输出电平 RMS（0~1 线性）
    pub fn output_levels(&self) -> [f32; EQ_CHANNEL_COUNT] {
        [self.output_meters[0].rms(), self.output_meters[1].rms()]
    }

    /// 更新架桥滤波器系数
    fn recompute_shelves(&mut self) {
        /// 低音架桥截止频率（Hz）
        const BASS_SHELF_FREQ: f32 = 200.0;
        /// 高音架桥截止频率（Hz）
        const TREBLE_SHELF_FREQ: f32 = 3500.0;
        /// 架桥滤波器 Q 值
        const SHELF_Q: f32 = 0.707;

        for filter in self.bass_shelf.iter_mut() {
            filter.set_by_type(FilterType::LowShelf, BASS_SHELF_FREQ, self.sample_rate, SHELF_Q, self.bass_gain_db);
        }
        for filter in self.treble_shelf.iter_mut() {
            filter.set_by_type(FilterType::HighShelf, TREBLE_SHELF_FREQ, self.sample_rate, SHELF_Q, self.treble_gain_db);
        }
    }

    /// 重算所有滤波器系数（变更采样率后调用）
    fn recompute_coefficients(&mut self) {
        for band in self.bands.iter_mut() {
            for filter in band.filters.iter_mut() {
                filter.set_by_type(
                    band.params.filter_type,
                    band.params.freq,
                    self.sample_rate,
                    band.params.q,
                    band.params.gain_db,
                );
            }
        }
        self.recompute_shelves();
        self.sync_biquad_smooth_coef();
    }

    /// 把 Equalizer 全局 smooth_coef 同步到所有 biquad（含 band/bass_shelf/treble_shelf）
    /// biquad 内的 process_sample 依赖此系数做系数平滑
    fn sync_biquad_smooth_coef(&mut self) {
        let alpha = self.smooth_coef;
        for band in self.bands.iter_mut() {
            for filter in band.filters.iter_mut() {
                filter.smooth_coef = alpha;
            }
        }
        for filter in self.bass_shelf.iter_mut() {
            filter.smooth_coef = alpha;
        }
        for filter in self.treble_shelf.iter_mut() {
            filter.smooth_coef = alpha;
        }
    }

    /// 处理交错排列的立体声 PCM（L R L R ...）。EQ 关闭或 bypass 时直接返回。
    /// 处理顺序：input meter → preamp（平滑）→ 各频段 → bass shelf → treble shelf → surround（平滑）→ hard clip → output meter
    pub fn process_interleaved_stereo(&mut self, samples: &mut [f32]) {
        if !self.enabled {
            return;
        }
        // bypass：跳过滤波但仍采样输入/输出电平（A/B 对比时观察）
        if self.bypass {
            for frame in samples.chunks_exact_mut(EQ_CHANNEL_COUNT) {
                self.input_meters[0].push(frame[0]);
                self.input_meters[1].push(frame[1]);
                self.output_meters[0].push(frame[0]);
                self.output_meters[1].push(frame[1]);
            }
            return;
        }
        let has_shelf = self.bass_gain_db.abs() >= 1e-3 || self.treble_gain_db.abs() >= 1e-3;
        // 任一频段增益非 0 视为有滤波
        let bands_have_gain = self
            .bands
            .iter()
            .any(|b| b.params.filter_type != FilterType::Passthrough && b.params.gain_db.abs() >= 1e-3);
        let alpha = self.smooth_coef;
        // preamp / surround 每帧向 target 逼近一次；chunk 较小时一次性 chunk 内逐样本平滑
        let mut preamp = self.preamp_linear;
        let mut surround = self.surround_gain;
        // 是否存在抬升路径：决定是否需要 hard clip 防止超界爆音
        let has_boost = preamp > 1.0001 || self.preamp_target > 1.0001
            || (has_shelf && (self.bass_gain_db > 0.0 || self.treble_gain_db > 0.0))
            || (bands_have_gain && self.bands.iter().any(|b| b.params.gain_db > 0.0))
            || surround > 1.0001 || self.surround_target > 1.0001;
        for frame in samples.chunks_exact_mut(EQ_CHANNEL_COUNT) {
            let in_left = frame[0];
            let in_right = frame[1];
            self.input_meters[0].push(in_left);
            self.input_meters[1].push(in_right);

            // 一阶低通平滑：消除滑块拖动时的样本级阶跃爆音
            preamp += (self.preamp_target - preamp) * alpha;
            surround += (self.surround_target - surround) * alpha;

            let mut left = in_left * preamp;
            let mut right = in_right * preamp;
            for band in self.bands.iter_mut() {
                left = band.filters[0].process_sample(left);
                right = band.filters[1].process_sample(right);
            }
            if has_shelf {
                left = self.bass_shelf[0].process_sample(left);
                right = self.bass_shelf[1].process_sample(right);
                left = self.treble_shelf[0].process_sample(left);
                right = self.treble_shelf[1].process_sample(right);
            }
            if (surround - 1.0).abs() >= 1e-3 {
                // Mid/Side 处理：M = (L+R)/2, S = (L-R)/2
                // 调整 Side 增益后重建：L' = M + S*gain, R' = M - S*gain
                let mid = (left + right) * 0.5;
                let side = (left - right) * 0.5 * surround;
                left = mid + side;
                right = mid - side;
            }
            // 硬限制：仅在存在抬升路径时启用，防止样本超界爆音。
            // 透明路径（无抬升）完全跳过，避免对未做任何增益的素材施加处理。
            // 不使用 tanh：tanh 会对全程信号产生奇次谐波失真，是音色浑浊主因。
            if has_boost {
                left = left.clamp(-1.0, 1.0);
                right = right.clamp(-1.0, 1.0);
            }
            self.output_meters[0].push(left);
            self.output_meters[1].push(right);
            frame[0] = left;
            frame[1] = right;
        }
        // chunk 处理完毕，回写当前生效值（下个 chunk 继续从此处逼近 target）
        self.preamp_linear = preamp;
        self.surround_gain = surround;
    }
}
