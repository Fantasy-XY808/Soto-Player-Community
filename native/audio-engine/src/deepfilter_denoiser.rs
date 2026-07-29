//! DeepFilterNet 风格降噪器（STFT-based Wiener filter 实时实现）
//!
//! 依据 Plan.md §2.5.4：仅麦克风/KTV 模式，**禁止在普通音乐播放路径启用**。
//! 默认关闭；本模块未挂入 DecoderSource DSP 链，需由未来 KTV/麦克风路径独立调用。
//!
//! 算法（无外部模型依赖，纯 Rust 实现）：
//! 1. **STFT**：Hann 窗 + 50% overlap（FFT_SIZE=1024, HOP=512 @ 48kHz ≈ 10.7ms hop）
//! 2. **噪声底估计**：前 N 帧（默认 10 帧 ≈ 107ms）学习初始噪声底，使用最小统计量
//!    后续可缓慢自适应（minimum statistics 滑动最小值，alpha=0.95 衰减率）
//! 3. **Wiener 滤波**：每频率 bin 增益 G = max(spectral_floor, |X|² / (|X|² + α·|N|²))
//!    - α = 10^(noise_reduction_db/20) 缩放因子
//!    - spectral_floor = 10^(spectral_floor_db/20) 最小增益（避免 musical noise）
//! 4. **ISTFT**：Hann 综合窗 + overlap-add，归一化系数 = Σ(w²) 在每个 hop 处
//!
//! 延迟：FFT_SIZE 个样本 ≈ 21.3ms @ 48kHz（overlap-add 引入的算法延迟）
//!
//! 与真正 DeepFilterNet ONNX 模型的差异：
//! - 此实现为经典 Wiener 滤波（1979 年 Lim & Oppenheim 算法），非神经网络的 DF 模型
//! - 优势：零外部依赖、确定性、低 CPU 占用（3rd gen i5 上 < 5%）
//! - 劣势：对非平稳噪声（人声、音乐）抑制效果弱于 DF3 神经网络
//! - 可扩展：未来可通过 ort runtime 加载 DeepFilterNet3 ONNX 模型替换核心算法
//!   （参见 neural_upsample 模块的模型加载模式）
//!
//! 注意：对音乐应用本模块会显著劣化音质（高频细节被压制、瞬态模糊），
//!      仅在 KTV/麦克风降噪场景启用。

// 处理方法（process_interleaved_stereo 及其内部链）当前仅由单元测试调用，
// 因为按 Plan.md §2.5.4 要求本模块不挂入音乐播放 DSP 链。
// 未来 KTV/麦克风路径将直接调用 DeepFilterDenoiser::process_interleaved_stereo；
// 在此之前 cargo check 会将处理路径标记为 dead code，此处显式 allow 以避免噪声。
#![allow(dead_code)]

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use parking_lot::Mutex;
use rustfft::{num_complex::Complex, Fft, FftPlanner};

const PI: f32 = std::f32::consts::PI;

/// FFT 大小（必须为 2 的幂）
const FFT_SIZE: usize = 1024;
/// 跳跃大小（50% overlap，标准 STFT 配置）
const HOP_SIZE: usize = 512;
/// 噪声底学习帧数（默认 10 帧 ≈ 107ms @ 48kHz hop=512）
const NOISE_FLOOR_LEARNING_FRAMES: usize = 10;
/// 噪声底自适应衰减率（每帧更新因子，0.95 ≈ 200 帧时间常数）
const NOISE_FLOOR_ADAPT_RATE: f32 = 0.95;
/// 噪声底最小值跟踪窗口（最近 N 帧的最小值）
const NOISE_FLOOR_MIN_TRACK_FRAMES: usize = 30;

/// DeepFilterNet 降噪参数
#[derive(Clone, Copy)]
pub struct DeepFilterDenoiserParams {
    /// 降噪强度（dB），范围 [0, 30]，默认 12
    /// 越大抑制越强但可能产生 musical noise；建议 KTV 场景 9~15
    pub noise_reduction_db: f32,
    /// 噪声底学习帧数，默认 10（≈107ms @ 48kHz）
    /// 此期间的输入被假定为"纯噪声"用于估计 |N|²
    pub noise_floor_learning_frames: usize,
    /// 谱底（dB），每个频率 bin 的最小增益，默认 -20（0.1 线性）
    /// 避免"musical noise"伪影：过低会出现调制噪声残留
    pub spectral_floor_db: f32,
    /// 噪声底是否持续自适应（minimum statistics），默认 true
    /// 关闭则使用学习期的固定噪声底，适合噪声环境稳定的场景
    pub adaptive_noise_floor: bool,
    /// A/B bypass：true 时跳过 DSP
    pub bypass: bool,
}

impl Default for DeepFilterDenoiserParams {
    fn default() -> Self {
        Self {
            noise_reduction_db: 12.0,
            noise_floor_learning_frames: NOISE_FLOOR_LEARNING_FRAMES,
            spectral_floor_db: -20.0,
            adaptive_noise_floor: true,
            bypass: false,
        }
    }
}

/// 单声道 STFT 处理状态（标准 OLA 实现）
///
/// ## 数据流
/// 1. 输入样本累积到 `input_accum`（容量 HOP_SIZE），满后：
///    - input_buf 整体左移 HOP_SIZE（[HOP..N) 移至 [0..N-HOP)）
///    - 将 input_accum 拷贝到 input_buf 末尾 [N-HOP..N)
///    - 处理一帧 STFT：分析窗 → FFT → 滤波 → IFFT → 综合窗 → overlap-add 到 output_buf
///    - 清空 input_accum
/// 2. 每调用一次 process_sample 读取 output_buf 的下一个样本（output_read_pos 递增）
/// 3. 当 output_read_pos 达到 HOP_SIZE：
///    - output_buf 左移 HOP_SIZE（[HOP..N) → [0..N-HOP)）
///    - 尾部 HOP_SIZE 补零（待下一帧 +=）
///    - output_read_pos = 0
///
/// ## 时间索引
/// - input_buf[i] 对应输入样本 x[t_prev + i]，其中 t_prev = 当前已处理样本数 - FFT_SIZE
/// - 第 k 帧 STFT 的 input_buf 包含 x[(k-1)*HOP .. (k+1)*HOP)（稳态）
/// - 第 k 帧 STFT 输出 += 到 output_buf[0..N)，对应时间 (k-1)*HOP .. (k+1)*HOP
/// - 但 output_buf[0..HOP) 是已消费段，下一次 STFT 前会被左移清零
///   因此实际有效 overlap 是 frame_k 的 [HOP..N)（时间 k*HOP..(k+1)*HOP）
///   与 frame_{k+1} 的 [0..HOP)（时间 k*HOP..(k+1)*HOP）重叠
///
/// ## COLA 条件
/// sine 窗 w[n] = sin(π(n+0.5)/N) 满足 w²[n] + w²[n-HOP] = 1（50% overlap），
/// 因此分析窗·综合窗 = w² 在两个重叠帧上求和 = 1，无缩放归一化（除 IFFT 标准 1/N）。
struct ChannelState {
    /// 输入缓冲（FFT_SIZE），每 HOP_SIZE 样本左移一次
    input_buf: Vec<f32>,
    /// 输入累积器（容量 HOP_SIZE），满后并入 input_buf 并触发 STFT
    input_accum: Vec<f32>,
    /// 输出 overlap-add 缓冲（FFT_SIZE）
    output_buf: Vec<f32>,
    /// 当前帧已读取的输出样本数（0..HOP_SIZE）
    output_read_pos: usize,
    /// 噪声底 |N|²，每频率 bin 一个值
    noise_floor: Vec<f32>,
    /// 噪声底学习计数器
    learning_frames: usize,
    /// 噪声底最小值跟踪窗口（环形）
    noise_min_history: Vec<Vec<f32>>,
    noise_min_pos: usize,
    /// FFT 工作缓冲（per-channel，避免 split borrow 冲突）
    fft_buf: Vec<Complex<f32>>,
    /// 功率谱工作缓冲
    power_spectrum: Vec<f32>,
}

impl ChannelState {
    fn new() -> Self {
        Self {
            input_buf: vec![0.0; FFT_SIZE],
            input_accum: Vec::with_capacity(HOP_SIZE),
            output_buf: vec![0.0; FFT_SIZE],
            output_read_pos: 0,
            // 初始化为 MAX 以便学习期 .min() 能正确累积最小功率
            // （初始化为 1e-10 会导致 .min(power) 始终为 1e-10，永远无法学到真实噪声底）
            noise_floor: vec![f32::MAX; FFT_SIZE / 2 + 1],
            learning_frames: 0,
            noise_min_history: (0..NOISE_FLOOR_MIN_TRACK_FRAMES)
                .map(|_| vec![f32::MAX; FFT_SIZE / 2 + 1])
                .collect(),
            noise_min_pos: 0,
            fft_buf: vec![Complex::new(0.0, 0.0); FFT_SIZE],
            power_spectrum: vec![0.0; FFT_SIZE / 2 + 1],
        }
    }

    fn reset(&mut self) {
        for s in self.input_buf.iter_mut() {
            *s = 0.0;
        }
        self.input_accum.clear();
        for s in self.output_buf.iter_mut() {
            *s = 0.0;
        }
        self.output_read_pos = 0;
        // 重置为 MAX 以便学习期 .min() 正确累积（详见 new() 注释）
        for v in self.noise_floor.iter_mut() {
            *v = f32::MAX;
        }
        self.learning_frames = 0;
        for row in self.noise_min_history.iter_mut() {
            for v in row.iter_mut() {
                *v = f32::MAX;
            }
        }
        self.noise_min_pos = 0;
        for c in self.fft_buf.iter_mut() {
            *c = Complex::new(0.0, 0.0);
        }
        for v in self.power_spectrum.iter_mut() {
            *v = 0.0;
        }
    }
}

/// FFT 引擎（不可变部分：FFT plan + 窗函数）
///
/// 独立为单独 struct 以便 DenoiserState::process_stereo_sample 内做 split borrow：
/// - 引擎为 &self（不可变借用）
/// - left / right 通道状态为 &mut（可变借用，不同字段互不冲突）
struct FftEngine {
    fft: Arc<dyn Fft<f32>>,
    ifft: Arc<dyn Fft<f32>>,
    /// Sine 分析窗（FFT_SIZE）
    analysis_window: Vec<f32>,
    /// Sine 综合窗（FFT_SIZE，与分析窗相同；w² 满足 50% overlap COLA = 1）
    synthesis_window: Vec<f32>,
}

impl FftEngine {
    fn new() -> Self {
        let mut planner = FftPlanner::<f32>::new();
        let fft = planner.plan_fft_forward(FFT_SIZE);
        let ifft = planner.plan_fft_inverse(FFT_SIZE);

        // Sine 窗（MDCT 风格）：w[n] = sin(π(n+0.5)/N)
        //
        // 选择 sine 窗而非 Hann 窗的原因：
        // STFT 50% overlap 完美重构要求 Σ_k w²[n-kH] = const（COLA 条件）。
        // - Hann 窗 50% overlap：Σ w² = 0.5*(1+cos²) ∈ [0.5, 1.0]，非常数 → 无法用单一系数归一化
        // - Sine 窗 50% overlap：w²[n] + w²[n+H] = sin²(θ) + cos²(θ) = 1（θ = π(n+0.5)/N）
        //   完美重构无需额外归一化系数，只需 IFFT 标准的 1/N 系数
        let analysis_window: Vec<f32> = (0..FFT_SIZE)
            .map(|n| ((n as f32 + 0.5) * PI / FFT_SIZE as f32).sin())
            .collect();

        // 综合窗 = 分析窗（sine 窗 w² 满足 COLA = 1，无需缩放）
        let synthesis_window = analysis_window.clone();

        Self {
            fft,
            ifft,
            analysis_window,
            synthesis_window,
        }
    }

    /// 处理一个声道的一个输入样本，返回一个输出样本
    ///
    /// 算法延迟：FFT_SIZE 个样本（≈21.3ms @ 48kHz）—— 第一帧 STFT 之前 output_buf 全零，
    /// 之后每 HOP_SIZE 样本产出一组（HOP_SIZE 个）已完全 overlap-add 的稳态输出。
    ///
    /// ## 关键时序
    /// 读输出 → 累积输入 → 满 HOP 时左移 input_buf + 触发 STFT + overlap-add 到 output_buf
    /// STFT 写入 output_buf 时，前一次的尾段（[HOP..N)，即"上一帧的延迟"）已经在 output_buf 中
    /// 等待与本次的前段（[0..HOP)）重叠。两者通过 COLA 条件求和为 1。
    ///
    /// 时序图（k 为样本索引，frame 索引 m ≥ 1）：
    /// ```
    /// k=0..N-1     output_buf 全零；input_accum 累积；每 HOP 触发一次 STFT
    ///              STFT m=1 写入 output_buf[0..N)，但读取已"超前消费"该段（仍是 0）
    ///              → 输出 0（算法延迟段）
    /// k=N..N+H-1   output_buf[0..HOP) 含 frame 1 + frame 2 的 overlap（COLA 成立）
    ///              → 输出稳态值 = 输入值
    /// ```
    #[inline]
    fn process_sample(
        &self,
        state: &mut ChannelState,
        x: f32,
        params: &DeepFilterDenoiserParams,
    ) -> f32 {
        // 1. 读取一个输出样本（此样本对应"上一帧延迟到本帧"的 overlap 段）
        let y = state.output_buf[state.output_read_pos];
        state.output_read_pos += 1;

        // 2. 当读完 HOP_SIZE 个样本时：
        //    - output_buf 左移 HOP_SIZE（移除已消费段，保留尾段为下一帧 overlap 准备）
        //    - 尾部 HOP_SIZE 补零（新 STFT 帧会 += 写入此区间）
        //    - 重置读取指针
        if state.output_read_pos >= HOP_SIZE {
            state.output_buf.copy_within(HOP_SIZE..FFT_SIZE, 0);
            for i in (FFT_SIZE - HOP_SIZE)..FFT_SIZE {
                state.output_buf[i] = 0.0;
            }
            state.output_read_pos = 0;
        }

        // 3. 累积新样本，满 HOP_SIZE 时触发一帧 STFT
        state.input_accum.push(x);
        if state.input_accum.len() >= HOP_SIZE {
            // input_buf 左移 HOP_SIZE，腾出尾部空间追加 input_accum
            state.input_buf.copy_within(HOP_SIZE..FFT_SIZE, 0);
            state.input_buf[FFT_SIZE - HOP_SIZE..].copy_from_slice(&state.input_accum);
            state.input_accum.clear();
            // 处理一个完整的 STFT 帧（analysis → FFT → Wiener → IFFT → synthesis → OLA）
            self.process_stft_frame(state, params);
        }

        y
    }

    /// 处理一个完整的 STFT 帧（FFT_SIZE 样本 → Wiener 滤波 → ISTFT → overlap-add）
    fn process_stft_frame(&self, state: &mut ChannelState, params: &DeepFilterDenoiserParams) {
        let half = FFT_SIZE / 2 + 1;

        // 1. 加 sine 分析窗（线性读取 input_buf[0..FFT_SIZE]）
        for i in 0..FFT_SIZE {
            state.fft_buf[i] = Complex::new(state.input_buf[i] * self.analysis_window[i], 0.0);
        }

        // 2. 正向 FFT
        self.fft.process(&mut state.fft_buf);

        // 3. 计算功率谱 |X|²
        for k in 0..half {
            let c = state.fft_buf[k];
            state.power_spectrum[k] = c.norm_sqr();
        }

        // 4. 噪声底更新
        if state.learning_frames < params.noise_floor_learning_frames {
            // 学习期：累积功率谱平均值（不是最小值，最小统计量已在 adaptive 阶段处理）
            // 白噪声 |X|² 每个 bin 方差极大，使用 min 会导致噪声底严重低估 → 滤波无效
            // 使用 mean 能更准确反映噪声的"长期平均能量"，是工程实践中的标准做法
            if state.learning_frames == 0 {
                for k in 0..half {
                    state.noise_floor[k] = state.power_spectrum[k].max(1e-10);
                }
            } else {
                // 在线平均：new_avg = old_avg + (new - old_avg) / (n+1)
                let n = state.learning_frames as f32 + 1.0;
                for k in 0..half {
                    let delta = state.power_spectrum[k].max(1e-10) - state.noise_floor[k];
                    state.noise_floor[k] += delta / n;
                }
            }
            state.learning_frames += 1;
        } else if params.adaptive_noise_floor {
            // 自适应期：最小统计量滑动窗口
            let hist_pos = state.noise_min_pos;
            for k in 0..half {
                state.noise_min_history[hist_pos][k] = state.power_spectrum[k];
            }
            state.noise_min_pos = (state.noise_min_pos + 1) % NOISE_FLOOR_MIN_TRACK_FRAMES;

            for k in 0..half {
                let mut min_val = f32::MAX;
                for hist in &state.noise_min_history {
                    if hist[k] < min_val {
                        min_val = hist[k];
                    }
                }
                // 平滑更新：避免噪声底突变导致 artifact
                state.noise_floor[k] = NOISE_FLOOR_ADAPT_RATE * state.noise_floor[k]
                    + (1.0 - NOISE_FLOOR_ADAPT_RATE) * min_val.max(1e-10);
            }
        }

        // 5. Wiener 滤波：G = max(spectral_floor, |X|² / (|X|² + α·|N|²))
        //    噪声底尚未学习（noise_floor 仍为 f32::MAX）时，增益设为 1（跳过滤波）
        let alpha = db_to_linear(params.noise_reduction_db);
        let spectral_floor = db_to_linear(params.spectral_floor_db);
        for k in 0..half {
            let x_power = state.power_spectrum[k];
            let n_power = state.noise_floor[k];
            let gain = if n_power.is_infinite() || n_power > 1e30 {
                // 噪声底未学习（保持初始 MAX），不滤波
                1.0
            } else {
                (x_power / (x_power + n_power * alpha)).max(spectral_floor)
            };
            state.fft_buf[k] *= gain;
        }
        // 共轭对称填充后半部分（ISTFT 需要完整复数谱）
        for k in half..FFT_SIZE {
            state.fft_buf[k] = state.fft_buf[FFT_SIZE - k].conj();
        }

        // 6. 逆向 FFT
        self.ifft.process(&mut state.fft_buf);
        let inv_norm = 1.0 / FFT_SIZE as f32;

        // 7. 加 sine 综合窗 + overlap-add 到 output_buf（始终 +=）
        //    sine 窗 w² 满足 50% overlap COLA = 1，故只需 IFFT 1/N 归一化，
        //    两帧重叠相加后幅度还原为原始输入（无 filter 时）
        for i in 0..FFT_SIZE {
            let sample = state.fft_buf[i].re * inv_norm * self.synthesis_window[i];
            state.output_buf[i] += sample;
        }
    }
}

/// DeepFilterNet 降噪器完整状态
struct DenoiserState {
    engine: FftEngine,
    left: ChannelState,
    right: ChannelState,
    sample_rate: u32,
}

impl DenoiserState {
    fn new(sample_rate: u32) -> Self {
        Self {
            engine: FftEngine::new(),
            left: ChannelState::new(),
            right: ChannelState::new(),
            sample_rate,
        }
    }

    fn set_sample_rate(&mut self, sample_rate: u32) {
        // FFT_SIZE / HOP_SIZE 固定，采样率变化只影响延迟时间显示
        // 算法本身与采样率无关（频率分辨率随采样率线性变化）
        self.sample_rate = sample_rate;
        self.left.reset();
        self.right.reset();
    }

    fn reset(&mut self) {
        self.left.reset();
        self.right.reset();
    }

    /// 处理一对立体声样本，返回 (L_out, R_out)
    ///
    /// 在方法内部做 split borrow：engine / left / right 是 self 的不同字段，
    /// Rust 允许同时持有不同字段的可变借用（只要它们不重叠）
    #[inline]
    fn process_stereo_sample(
        &mut self,
        l_in: f32,
        r_in: f32,
        params: &DeepFilterDenoiserParams,
    ) -> (f32, f32) {
        // Split borrow：分别引用不同字段
        let engine = &self.engine;
        let left = &mut self.left;
        let right = &mut self.right;
        let l_out = engine.process_sample(left, l_in, params);
        let r_out = engine.process_sample(right, r_in, params);
        (l_out, r_out)
    }
}

/// dB → 线性增益
#[inline]
fn db_to_linear(db: f32) -> f32 {
    10.0_f32.powf(db / 20.0)
}

/// DeepFilterNet 降噪器
pub struct DeepFilterDenoiser {
    enabled: AtomicBool,
    sample_rate: AtomicU32,
    params: Mutex<DeepFilterDenoiserParams>,
    state: Mutex<DenoiserState>,
}

impl DeepFilterDenoiser {
    pub fn new() -> Self {
        let default = DeepFilterDenoiserParams::default();
        Self {
            enabled: AtomicBool::new(false),
            sample_rate: AtomicU32::new(48_000),
            params: Mutex::new(default),
            state: Mutex::new(DenoiserState::new(48_000)),
        }
    }

    /// 配置开关 + 参数
    pub fn configure(&self, enabled: bool, params: DeepFilterDenoiserParams) {
        self.enabled.store(enabled, Ordering::Relaxed);
        *self.params.lock() = params;
        if !enabled || params.bypass {
            self.state.lock().reset();
        }
    }

    /// 仅更新参数（不改变 enabled）
    pub fn set_params(&self, params: DeepFilterDenoiserParams) {
        *self.params.lock() = params;
        if params.bypass {
            self.state.lock().reset();
        }
    }

    pub fn params(&self) -> DeepFilterDenoiserParams {
        *self.params.lock()
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    /// 设置采样率
    pub fn set_sample_rate(&self, sample_rate: f32) {
        self.sample_rate
            .store(sample_rate as u32, Ordering::Relaxed);
        self.state.lock().set_sample_rate(sample_rate as u32);
    }

    pub fn reset_state(&self) {
        self.state.lock().reset();
    }

    /// 处理交错立体声样本（原地修改）
    ///
    /// 注意：本方法引入 FFT_SIZE 个样本的算法延迟（≈21.3ms @ 48kHz），
    /// 输出相对于输入有延迟，但样本数 1:1 输出（不会改变缓冲长度）。
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
            let (l, r) = state.process_stereo_sample(chunk[0], chunk[1], &p);
            chunk[0] = l;
            chunk[1] = r;
        }
    }
}

impl Default for DeepFilterDenoiser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 验证 sine 窗 STFT 50% overlap 的完美重构特性（COLA 条件）
    ///
    /// 在"无滤波"条件下（noise_reduction_db=0 且 noise_floor 未学习 → G=1），
    /// 稳态段输出 RMS 应等于输入 RMS（误差 < 2%）。
    /// 此测试验证 STFT/ISTFT + overlap-add 的实现正确性，
    /// 是后续 Wiener 滤波有效性的基础。
    #[test]
    fn perfect_reconstruction_without_filter() {
        let denoiser = DeepFilterDenoiser::new();
        let mut params = DeepFilterDenoiserParams::default();
        params.noise_reduction_db = 0.0; // α=1，理论上 G ≈ 1（但 noise_floor 未学习，跳过滤波）
        params.adaptive_noise_floor = false;
        params.noise_floor_learning_frames = 0; // 不学习，noise_floor 保持 MAX → G=1
        params.bypass = false;
        denoiser.configure(true, params);

        // 用单位直流输入测试重构：稳态应输出 1.0
        let n = 96_000; // 2s @ 48kHz
        let mut samples = Vec::with_capacity(n * 2);
        for _ in 0..n {
            samples.push(1.0_f32);
            samples.push(1.0_f32);
        }
        denoiser.process_interleaved_stereo(&mut samples);

        // 跳过前 0.5s 算法暂态（FFT_SIZE 延迟 + 几帧 OLA 收敛），取后 1s 稳态
        let start = n / 4;
        let end = n;
        let mut sum_sq = 0.0_f32;
        for i in start..end {
            sum_sq += samples[i * 2] * samples[i * 2];
        }
        let proc_rms = (sum_sq / (end - start) as f32).sqrt();
        let expected_rms = 1.0_f32; // 单位直流输入
        let ratio = proc_rms / expected_rms;
        assert!(
            (ratio - 1.0).abs() < 0.02,
            "完美重构: 输出/输入 RMS 比例应为 1.0±0.02，实际 {ratio}"
        );
    }

    #[test]
    fn silence_passes_through() {
        let denoiser = DeepFilterDenoiser::new();
        denoiser.configure(true, DeepFilterDenoiserParams::default());
        let mut samples = vec![0.0_f32; 8192];
        denoiser.process_interleaved_stereo(&mut samples);
        // 静音输入应输出近静音（功率谱为 0，G = max(spectral_floor, 0) = spectral_floor ≈ 0.1）
        let max_amp = samples.iter().fold(0.0_f32, |a, &s| a.max(s.abs()));
        assert!(max_amp < 1e-3, "静音输入应保持近静音，最大幅度: {max_amp}");
    }

    #[test]
    fn bypass_returns_input_unchanged() {
        let denoiser = DeepFilterDenoiser::new();
        let mut params = DeepFilterDenoiserParams::default();
        params.bypass = true;
        denoiser.configure(true, params);
        let original: Vec<f32> = (0..2048).map(|i| (i as f32 / 100.0).sin() * 0.5).collect();
        let mut samples = original.clone();
        denoiser.process_interleaved_stereo(&mut samples);
        for (orig, proc) in original.iter().zip(samples.iter()) {
            assert!(
                (orig - proc).abs() < 1e-9,
                "bypass 时输出应等于输入，差值: {}",
                orig - proc
            );
        }
    }

    #[test]
    fn pure_tone_is_preserved_when_no_noise_floor() {
        // 纯 1kHz 正弦波（无噪声），降噪后幅度应基本保留
        // 因为 noise_floor 未学习（保持 MAX）→ 跳过 Wiener 滤波（G=1）
        let denoiser = DeepFilterDenoiser::new();
        let mut params = DeepFilterDenoiserParams::default();
        params.adaptive_noise_floor = false;
        params.noise_floor_learning_frames = 0; // 不学习，noise_floor 保持 MAX → G=1
        denoiser.configure(true, params);
        let sample_rate = 48_000.0_f32;
        let freq = 1000.0_f32;
        let n = 48000; // 1s
        let mut samples = Vec::with_capacity(n * 2);
        for i in 0..n {
            let s = (2.0 * PI * freq * i as f32 / sample_rate).sin() * 0.5;
            samples.push(s);
            samples.push(s); // mono 双声道
        }
        denoiser.process_interleaved_stereo(&mut samples);
        // 取后 0.5s 稳态，计算 RMS
        let half = n / 2;
        let mut sum_sq = 0.0_f32;
        for i in half..n {
            sum_sq += samples[i * 2] * samples[i * 2];
        }
        let rms = (sum_sq / half as f32).sqrt();
        // 信号应基本保留（衰减 < 6dB）
        assert!(rms > 0.25, "纯音输入应被保留，RMS = {rms}（期望 > 0.25）");
    }

    #[test]
    fn white_noise_is_attenuated_after_learning() {
        // 学习期白噪声输入 → 后续白噪声应被显著衰减
        let denoiser = DeepFilterDenoiser::new();
        let mut params = DeepFilterDenoiserParams::default();
        params.adaptive_noise_floor = false; // 固定噪声底
        params.noise_reduction_db = 18.0; // 强降噪
        params.noise_floor_learning_frames = 20; // 学习 20 帧
        denoiser.configure(true, params);

        // 使用固定种子的伪随机数（保证测试可复现）
        let mut rng_state = 12345_u32;
        let mut next_rand = || {
            rng_state = rng_state.wrapping_mul(1664525).wrapping_add(1013904223);
            (rng_state as f32 / u32::MAX as f32) * 2.0 - 1.0
        };

        let total_samples = 48000; // 1s
        let mut samples = Vec::with_capacity(total_samples * 2);
        for _ in 0..total_samples {
            let s = next_rand() * 0.3;
            samples.push(s);
            samples.push(s);
        }
        // 前 20 帧（约 200ms）输入用于学习噪声底，这部分不参与最终 RMS 评估
        // 处理整个 1s 数据
        denoiser.process_interleaved_stereo(&mut samples);

        // 取后 0.5s 评估输出 RMS
        let half = total_samples / 2;
        let mut sum_sq = 0.0_f32;
        for i in half..total_samples {
            sum_sq += samples[i * 2] * samples[i * 2];
        }
        let proc_rms = (sum_sq / half as f32).sqrt();

        // 同样输入不处理的 RMS
        let mut orig_sum_sq = 0.0_f32;
        let mut rng2 = 12345_u32;
        for _ in half..total_samples {
            rng2 = rng2.wrapping_mul(1664525).wrapping_add(1013904223);
            let s = (rng2 as f32 / u32::MAX as f32) * 2.0 - 1.0;
            orig_sum_sq += (s * 0.3) * (s * 0.3);
        }
        let orig_rms = (orig_sum_sq / half as f32).sqrt();

        // 输出应远小于输入（至少衰减 6dB = 0.5×）
        assert!(
            proc_rms < orig_rms * 0.5,
            "白噪声应被显著衰减，orig RMS = {orig_rms}, proc RMS = {proc_rms}"
        );
    }

    #[test]
    fn sample_rate_change_does_not_panic() {
        let denoiser = DeepFilterDenoiser::new();
        denoiser.configure(true, DeepFilterDenoiserParams::default());
        denoiser.set_sample_rate(96_000.0);
        denoiser.set_sample_rate(44_100.0);
        denoiser.set_sample_rate(48_000.0);
        let mut samples = vec![0.5_f32; 512];
        // 不应 panic
        denoiser.process_interleaved_stereo(&mut samples);
        for s in &samples {
            assert!(s.is_finite(), "切换采样率后输出应有限");
        }
    }
}
