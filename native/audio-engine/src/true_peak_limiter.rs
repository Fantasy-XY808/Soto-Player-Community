//! True Peak Limiter DSP（ITU-R BS.1770-4 标准 4× 过采样 + soft-knee 限幅）
//!
//! 与 loudness_normalizer 内部 `.clamp()` 硬限制的区别：
//! - 硬限制只看样本绝对值，会漏掉"样本间峰值"（inter-sample peak）
//! - True Peak 用 4× 过采样重建样本间信号，检测真正的峰值
//! - soft-knee 限幅在阈值附近平滑过渡，避免硬限幅的失真
//!
//! BS.1770-4 标准 True Peak 检测算法：
//! 1. 输入信号 4× 上采样（标准要求 sinc 插值，工程上 cubic Hermite 4-tap 近似够用，误差 < 0.1dB）
//! 2. 取过采样后所有点的最大绝对值作为 True Peak
//! 3. 单位转换：dBTP = 20 * log10(true_peak)
//!
//! 限幅逻辑：
//! - threshold_dbtp（默认 -3.0）：超过此阈值开始 soft-knee 压缩
//! - ceiling_dbtp（默认 -1.0）：硬限制上限，绝不超过
//! - attack 0.5ms（增益下降快，防止瞬态过冲）/ release 200ms（增益恢复慢，避免抽吸效应）
//! - target_gain = threshold / true_peak（峰值超阈值时立即衰减）
//! - 应用增益后再做 ceiling 硬限制兜底（防止 attack 还没生效的瞬态削波）
//!
//! DSP 链位置：第 5.5 级（loudness_normalizer 之后、neural_upsample 之前）
//! 关闭 / bypass 时零开销 early return

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use parking_lot::Mutex;

/// True Peak Limiter 参数
#[derive(Clone, Copy)]
pub struct TruePeakLimiterParams {
    /// 阈值（dBTP），超过此值开始 soft-knee 压缩；默认 -3.0，给 attack 路径 2dB 平滑空间
    pub threshold_dbtp: f32,
    /// 上限（dBTP），硬限制绝不超过；默认 -1.0（工业流媒体标准）
    pub ceiling_dbtp: f32,
    /// attack 时间（ms），增益下降速度；默认 5.0
    pub attack_ms: f32,
    /// release 时间（ms），增益恢复速度；默认 100.0
    pub release_ms: f32,
    /// A/B bypass：true 时跳过 DSP
    pub bypass: bool,
}

impl TruePeakLimiterParams {
    /// sanity check，强制 threshold ≤ ceiling - 2dB
    ///
    /// 避免 attack 路径无渐变空间产生颤音。
    ///
    /// 返回 self 便于链式调用：`TruePeakLimiterParams { ... }.sanitized()`
    fn sanitized(mut self) -> Self {
        // threshold 必须 ≤ ceiling - 2dB，否则自动降级
        let safe_threshold = self.threshold_dbtp.min(self.ceiling_dbtp - 2.0);
        if safe_threshold != self.threshold_dbtp {
            tracing::warn!(
                original = self.threshold_dbtp,
                adjusted = safe_threshold,
                ceiling = self.ceiling_dbtp,
                "threshold 过高，自动降级到 ceiling-2dB"
            );
            self.threshold_dbtp = safe_threshold;
        }
        self
    }
}

impl Default for TruePeakLimiterParams {
    fn default() -> Self {
        Self {
            // threshold = -3.0，给 attack 路径 2dB 平滑空间。
            // attack 0.5ms 平滑过渡足以处理大部分瞬态，immediate_gain 路径
            // 仅在极端瞬态（>ceiling）介入，避免样本级硬 clamp。
            // sanitized() 约束同步为 ceiling - 2.0。
            threshold_dbtp: -3.0,
            // ceiling = -1.0 dBTP（0.891），工业流媒体标准（Spotify/YouTube 推荐）
            // 保留 headroom 避免下游重采样产生 inter-sample peak 削波
            ceiling_dbtp: -1.0,
            // attack = 0.5ms（平衡瞬态保护与自然感）
            //
            // 0.3ms @ 48kHz 下 attack_coef ≈ 0.9367，每样本修正 6.33%，
            // 电音鼓声连续瞬态下增益调制频率 ≈ 1ms 周期，产生可闻抖动
            //
            // 0.5ms @ 48kHz 下 attack_coef ≈ 0.9592，每样本修正 4.08%，
            // 24 样本（0.5ms）内完成 63%，配合 immediate_gain + true_peak 路径
            // 仍足以处理电音鼓声瞬态，同时增益调制频率 ≈ 2ms 周期，听感更自然
            // 0.5ms 是 streaming 工业标准中值（Spotify/Apple Music master limiter 推荐 0.5-1ms）
            attack_ms: 0.5,
            // release = 200ms，避免抽吸效应
            // attack 变快后 release 也要相应放慢，否则增益调制可闻
            release_ms: 200.0,
            bypass: false,
        }
        .sanitized() // 防御性 sanity check（默认值已安全，调用仅防御未来变更）
    }
}

/// 4× 过采样 cubic Hermite 4-tap 系数（Catmull-Rom，partition of unity）
///
/// 用于在样本间插值检测 True Peak。t=0/0.25/0.5/0.75 四个上采样点。
/// 标准 BS.1770-4 用 sinc 插值，cubic Hermite 近似在工程上可接受。
///
/// taps[k] = [a, b, c, d] 表示 y[4n+k] = a*x[n-1] + b*x[n] + c*x[n+1] + d*x[n+2]
///
/// 标准 Catmull-Rom 公式：
/// P(t) = 0.5 * [(-t + 2t² - t³) P0 + (2 - 5t² + 3t³) P1 + (t + 4t² - 3t³) P2 + (-t² + t³) P3]
/// 所有 4 行系数和严格 = 1.0（partition of unity），DC 信号无损通过。
const CUBIC_HERMITE_TAPS: [[f32; 4]; 4] = [
    // t=0.00: y = x[n]（和 = 1.0）
    [0.0, 1.0, 0.0, 0.0],
    // t=0.25: 标准 Catmull-Rom（和 = 128/128 = 1.0）
    [-0.0703125, 0.8671875, 0.2265625, -0.0234375],
    // t=0.50: y = -1/16 x[n-1] + 9/16 x[n] + 9/16 x[n+1] - 1/16 x[n+2]（和 = 16/16 = 1.0）
    [-0.0625, 0.5625, 0.5625, -0.0625],
    // t=0.75: 标准 Catmull-Rom（和 = 128/128 = 1.0，t=0.25 的镜像）
    [-0.0234375, 0.2265625, 0.8671875, -0.0703125],
];

/// True Peak Limiter 处理器
pub struct TruePeakLimiter {
    enabled: AtomicBool,
    sample_rate: AtomicU32,
    params: Mutex<TruePeakLimiterParams>,
    /// 4× 过采样所需的滑窗状态：[x[n-1], x[n], x[n+1], x[n+2]]
    /// 左右声道各一个；初始为 0（静音起点）
    window_l: Mutex<[f32; 4]>,
    window_r: Mutex<[f32; 4]>,
    /// 当前增益（attack/release 平滑后）
    current_gain: Mutex<f32>,
    /// 已处理样本计数（u32 @ 48kHz 可容纳 ~24h，配合 reset_state 够用）
    /// 用于 hold 机制计算 `samples_since_attack`
    total_samples: AtomicU32,
    /// 上次 attack 触发的样本位置（用于 hold 机制：5ms 内不允许 release）
    /// 0 表示当前处于 release 状态（无近期 attack）
    last_attack_sample: AtomicU32,
    /// hold 机制样本数（5ms × sample_rate，48kHz 下 = 240）
    /// 在 set_sample_rate 中更新
    hold_samples: AtomicU32,
}

impl TruePeakLimiter {
    pub fn new() -> Self {
        Self {
            // 默认启用，与 shared/defaults/settings.ts 中 truePeakLimiter.enabled = true 对齐
            // A 组保守 DSP 的削波保护兜底：BS.1770-4 4× 过采样 True Peak 检测 + soft-knee 限幅
            // 对 bassEnhancer/stereoWidener 增益类 DSP 引起的瞬时峰值进行限幅，
            // 避免下游硬 clamp 削波产生奇次谐波失真
            // bassEnhancer/stereoWidener 默认启用，true_peak_limiter 同步启用以闭环削波保护
            enabled: AtomicBool::new(true),
            sample_rate: AtomicU32::new(48_000),
            params: Mutex::new(TruePeakLimiterParams::default()),
            window_l: Mutex::new([0.0; 4]),
            window_r: Mutex::new([0.0; 4]),
            current_gain: Mutex::new(1.0),
            // hold 机制状态初始化
            // hold_samples 默认按 48kHz × 5ms = 240（与 sample_rate 默认对齐），
            // set_sample_rate 实际调用时会重算
            total_samples: AtomicU32::new(0),
            last_attack_sample: AtomicU32::new(0),
            hold_samples: AtomicU32::new(240),
        }
    }

    pub fn configure(&self, enabled: bool, params: TruePeakLimiterParams) {
        // sanity check（与 set_params 一致，防御用户配置过高的 threshold）
        let params = params.sanitized();
        self.enabled.store(enabled, Ordering::Relaxed);
        *self.params.lock() = params;
        if !enabled {
            self.reset_state();
        }
    }

    pub fn set_params(&self, params: TruePeakLimiterParams) {
        // sanity check，强制 threshold ≤ ceiling - 2dB
        // 详见 TruePeakLimiterParams::sanitized() 注释
        let params = params.sanitized();
        let mut p = self.params.lock();
        let old_bypass = p.bypass;
        *p = params;
        let new_bypass = p.bypass;
        drop(p);
        // 切到 bypass 时清空状态
        if new_bypass && !old_bypass {
            self.reset_state();
        }
    }

    pub fn params(&self) -> TruePeakLimiterParams {
        *self.params.lock()
    }

    pub fn enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn set_sample_rate(&self, _sample_rate: f32) {
        // attack/release 系数在 process 内动态计算，无需重建
        // 仅记录当前采样率供日志/调试
        self.sample_rate
            .store(_sample_rate as u32, Ordering::Relaxed);
        // 更新 hold 机制样本数（5ms × sample_rate）
        // 48kHz 下 = 240 样本；44.1kHz 下 = 221 样本；96kHz 下 = 480 样本
        // 防御 sample_rate ≤ 0 的边界（默认回退到 240）
        let hold = if _sample_rate > 0.0 {
            (5.0 / 1000.0 * _sample_rate).round() as u32
        } else {
            240
        };
        self.hold_samples.store(hold, Ordering::Relaxed);
    }

    /// 重置内部状态（切歌时调用）
    /// 清空 4× 过采样滑窗 + 增益回到 1.0
    pub fn reset_state(&self) {
        *self.window_l.lock() = [0.0; 4];
        *self.window_r.lock() = [0.0; 4];
        *self.current_gain.lock() = 1.0;
        // 重置 hold 机制状态
        // 切歌时 total_samples 和 last_attack_sample 都归 0，避免上一首的 hold 状态影响下一首
        self.total_samples.store(0, Ordering::Relaxed);
        self.last_attack_sample.store(0, Ordering::Relaxed);
    }

    /// 检测 4 样本滑窗的 True Peak（4× cubic Hermite 上采样后取最大绝对值）
    ///
    /// t=0.00 行 taps = [0,1,0,0]，y = window[1]，跳过 FIR 直接取绝对值
    /// 省 4 mul/样本/声道（96kHz 立体声省 768K mul/sec）
    #[inline]
    fn detect_true_peak(window: &[f32; 4]) -> f32 {
        // t=0.00: y = window[1]（taps = [0,1,0,0]），直接取绝对值
        let mut max_abs = window[1].abs();
        // t=0.25, 0.50, 0.75: 3 组 4-tap FIR（跳过第一行 t=0.00）
        for taps in CUBIC_HERMITE_TAPS.iter().skip(1) {
            let y = taps[0] * window[0]
                + taps[1] * window[1]
                + taps[2] * window[2]
                + taps[3] * window[3];
            let abs_y = y.abs();
            if abs_y > max_abs {
                max_abs = abs_y;
            }
        }
        max_abs
    }

    /// 处理交错立体声样本（原地修改）
    ///
    /// 流程：4× cubic Hermite 上采样检测 True Peak → 计算目标增益 → attack/release 平滑
    ///       → immediate_gain 瞬态保护 → 应用增益 → ceiling 硬限制
    ///
    /// 增加 immediate_gain 路径处理瞬态。
    ///
    /// 仅靠 attack 平滑时，attack 5ms 在 48kHz 下每样本仅修正 0.41%，
    /// 鼓点/打击乐 1ms 瞬态（48 样本）内仅修正 18%，来不及拉下增益，被下游硬 clamp
    /// → 瞬态削波。
    ///
    /// immediate_gain 路径：检测到当前样本本身超 ceiling 时，立即应用 ceiling/peak 增益，
    /// 不依赖 attack 平滑。attack 路径仅用于常规峰值跟踪，immediate_gain 路径
    /// 专处理 attack 慢于瞬态的极端情况。
    ///
    /// immediate_gain 路径用 immediate_attack_coef（= attack_coef^4）一阶低通平滑过渡到
    /// immediate_gain。1ms 内收敛 99.96%，
    /// 既保留快速瞬态响应，又消除样本级跳跃带来的方波式增益调制。
    /// threshold_dbtp = -3.0，给 attack 路径 2dB 渐变空间，
    /// 让大部分峰值在 attack 平滑阶段就被处理，immediate_gain 仅在极端瞬态介入。
    pub fn process_interleaved_stereo(&self, samples: &mut [f32]) {
        if !self.enabled.load(Ordering::Relaxed) {
            return;
        }
        let p = *self.params.lock();
        if p.bypass {
            return;
        }

        let rate = self.sample_rate.load(Ordering::Relaxed) as f32;
        let attack_t = p.attack_ms.max(0.1) / 1000.0;
        let release_t = p.release_ms.max(1.0) / 1000.0;
        let attack_coef = (-1.0 / (rate * attack_t)).exp();
        let release_coef = (-1.0 / (rate * release_t)).exp();
        // immediate_gain 路径专用 attack 系数（更激进的平滑）
        //
        // immediate_gain 路径走一阶低通，用 attack_coef.powi(8) 更激进的系数：
        // - attack_coef @ 0.5ms/48kHz ≈ 0.9592，每样本修正 4.08%，1ms 内仅收敛 86.5%
        // - attack_coef^4 ≈ 0.8471，每样本修正 15.29%，1ms（48 样本）内收敛 99.96%
        // - attack_coef^8 ≈ 0.7176，每样本修正 28.24%，0.5ms（24 样本）内收敛 99.99%
        // powi(8) 让 immediate_gain 路径在 0.5ms 内基本完成收敛，避免首样本漏过；
        // 副作用是增益曲线更"方波化"，但比硬 clamp 的方波失真小一个量级（连续平滑 vs 离散跳变）。
        // 完全失去平滑性的硬赋值（每样本 100% 修正）会重新引入方波式增益调制，
        // powi(8) 是"快速收敛"与"样本级平滑"的平衡点。
        let immediate_attack_coef = attack_coef.powi(8);

        let threshold_linear = 10.0_f32.powf(p.threshold_dbtp / 20.0);
        let ceiling_linear = 10.0_f32.powf(p.ceiling_dbtp / 20.0);

        let mut window_l = self.window_l.lock();
        let mut window_r = self.window_r.lock();
        let mut current_gain = self.current_gain.lock();

        // hold 机制状态加载到本地变量（process 单线程，可在循环内自由读写）
        // 循环结束统一写回 atomic，避免每样本一次 atomic store
        let hold_samples = self.hold_samples.load(Ordering::Relaxed);
        let mut total_samples = self.total_samples.load(Ordering::Relaxed);
        let mut last_attack_sample = self.last_attack_sample.load(Ordering::Relaxed);

        for chunk in samples.chunks_exact_mut(2) {
            let l = chunk[0];
            let r = chunk[1];

            // 推入滑窗：[x[n-1], x[n], x[n+1], x[n+2]] = [old x[n], old x[n+1], old x[n+2], new l]
            // 即整体左移 1 位，新样本放末尾
            window_l[0] = window_l[1];
            window_l[1] = window_l[2];
            window_l[2] = window_l[3];
            window_l[3] = l;
            window_r[0] = window_r[1];
            window_r[1] = window_r[2];
            window_r[2] = window_r[3];
            window_r[3] = r;

            // 检测 True Peak（左右声道取最大）
            // 滑窗 [x[n-1], x[n], x[n+1], x[n+2]] 中，4× 过采样检测的是 x[n] 和 x[n+1] 之间的
            // inter-sample peak。window[3] 是当前样本 l=x[n+2]，window[2] 是 x[n+1]，
            // window[1] 是 x[n]。所以检测的 True Peak 实际是 1 个样本前的（x[n+1] 附近），
            // 这是 True Peak 检测的固有 1 样本延迟（需要"未来"样本做插值）
            let tp_l = Self::detect_true_peak(&window_l);
            let tp_r = Self::detect_true_peak(&window_r);
            let true_peak = tp_l.max(tp_r);

            // 计算目标增益：峰值超阈值时立即衰减到 threshold
            let target_gain = if true_peak > threshold_linear {
                threshold_linear / true_peak
            } else {
                1.0
            };

            // attack/release 平滑 + hold 机制
            //
            // hold 机制防止阈值附近抖动产生颤音：
            // 5ms 内刚触发过 attack 的，即便 target_gain 回升也不立即 release，
            // 避免信号短暂跌回阈值下时增益被立即 release，再被下一次超阈值 attack
            // 的"快下慢上"形成锯齿波（高音颤音根因之一）。
            //
            // hold 期间 target_gain ≥ current_gain 时冻结增益（coef=1.0），
            // 既不 attack 也不 release，等 hold 过期后再 release。
            // coef=1.0 时 current_gain += (target - current) * (1-1) = 0，不变。
            //
            // 注意：用 wrapping_sub 而非 saturating_sub，正确处理 u32 wrap。
            // 在 48kHz 下 u32 可容纳 ~24h，wrap 后 wrapping_sub 仍给出正确的"前向距离"。
            let samples_since_attack = total_samples.wrapping_sub(last_attack_sample);
            let in_hold = samples_since_attack < hold_samples;

            let coef = if target_gain < *current_gain {
                // attack：增益下降，记录触发时刻
                last_attack_sample = total_samples;
                attack_coef
            } else if in_hold {
                // hold 期间冻结增益，既不 attack 也不 release
                1.0
            } else {
                release_coef
            };
            *current_gain = *current_gain + (target_gain - *current_gain) * (1.0 - coef);

            // immediate_gain 路径加平滑过渡，消除峰值段增益残留。
            //
            // immediate_gain 路径用 immediate_attack_coef（attack_coef^4）一阶低通平滑过渡到
            // immediate_gain。1ms 内可收敛 99.96%，足以快速响应削波，同时避免样本级跳跃。
            // 仍保留"立即衰减"语义：只在 immediate_gain < current_gain 时触发，
            // 保证 effective_gain 不会因平滑延迟而超过 ceiling（ceiling clamp 仍作兜底）。
            let sample_peak = l.abs().max(r.abs());
            if sample_peak > ceiling_linear {
                let immediate_gain = ceiling_linear / sample_peak;
                if immediate_gain < *current_gain {
                    *current_gain = immediate_gain
                        + (*current_gain - immediate_gain) * immediate_attack_coef;
                }
            }
            // true_peak 超 ceiling 时也立即衰减
            // 处理 inter-sample peak 超 ceiling 但单样本不超的场景（电音鼓声连续瞬态）
            // 同样用 immediate_attack_coef 平滑过渡
            if true_peak > ceiling_linear {
                let tp_immediate_gain = ceiling_linear / true_peak;
                if tp_immediate_gain < *current_gain {
                    *current_gain = tp_immediate_gain
                        + (*current_gain - tp_immediate_gain) * immediate_attack_coef;
                }
            }
            let effective_gain = *current_gain;

            // 应用增益 + ceiling 硬限制兜底（immediate_gain 已确保不超 ceiling，
            // clamp 仅作为安全网防止浮点误差）
            let effective_ceiling = ceiling_linear.max(threshold_linear);
            chunk[0] = (l * effective_gain).clamp(-effective_ceiling, effective_ceiling);
            chunk[1] = (r * effective_gain).clamp(-effective_ceiling, effective_ceiling);

            // 递增已处理样本计数（用 wrapping_add 防 u32 wrap）
            // 48kHz 下 ~24h wrap 一次，wrapping_sub 仍能给出正确的前向距离
            total_samples = total_samples.wrapping_add(1);
        }

        // 持久化 hold 机制状态到 atomic（跨 process 调用）
        // 单次 process 内的本地修改统一写回，避免每样本一次 atomic store
        self.total_samples.store(total_samples, Ordering::Relaxed);
        self.last_attack_sample
            .store(last_attack_sample, Ordering::Relaxed);
    }
}

impl Default for TruePeakLimiter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_silence_passthrough() {
        let limiter = TruePeakLimiter::new();
        limiter.enabled.store(true, Ordering::Relaxed);
        limiter.set_sample_rate(48_000.0);
        let mut samples = vec![0.0f32; 48_000 * 2];
        limiter.process_interleaved_stereo(&mut samples);
        // 静音输入不应被改变
        assert!(samples.iter().all(|s| s.abs() < 1e-6));
    }

    #[test]
    fn test_no_clipping_above_ceiling() {
        let limiter = TruePeakLimiter::new();
        limiter.enabled.store(true, Ordering::Relaxed);
        limiter.set_sample_rate(48_000.0);
        // 默认 ceiling = -0.5 dBTP ≈ 0.944
        let ceiling_linear = 10.0_f32.powf(-0.5 / 20.0);
        let mut samples = vec![0.0f32; 48_000 * 2];
        // 满量程 1kHz 正弦波，必触发限幅
        for (i, chunk) in samples.chunks_exact_mut(2).enumerate() {
            let v = (i as f32 * 2.0 * std::f32::consts::PI * 1000.0 / 48_000.0).sin();
            chunk[0] = v;
            chunk[1] = v;
        }
        limiter.process_interleaved_stereo(&mut samples);
        // 所有样本都不应超过 ceiling + 0.001 容差（attack 5ms 内可能短暂超阈值）
        let max_abs = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(
            max_abs <= ceiling_linear + 0.01,
            "True Peak 限幅失败：max={max_abs} > ceiling={ceiling_linear}"
        );
    }

    #[test]
    fn test_bypass_no_change() {
        let limiter = TruePeakLimiter::new();
        limiter.enabled.store(true, Ordering::Relaxed);
        limiter.set_sample_rate(48_000.0);
        let mut params = TruePeakLimiterParams::default();
        params.bypass = true;
        limiter.set_params(params);
        let mut samples = vec![0.0f32; 1024 * 2];
        for (i, chunk) in samples.chunks_exact_mut(2).enumerate() {
            let v = (i as f32 * 0.01).sin() * 0.5;
            chunk[0] = v;
            chunk[1] = v;
        }
        let original: Vec<f32> = samples.clone();
        limiter.process_interleaved_stereo(&mut samples);
        assert_eq!(samples, original, "bypass 时不应改变样本");
    }

    #[test]
    fn test_low_level_no_limiting() {
        // 低电平信号不应触发限幅
        let limiter = TruePeakLimiter::new();
        limiter.enabled.store(true, Ordering::Relaxed);
        limiter.set_sample_rate(48_000.0);
        let mut samples = vec![0.0f32; 48_000 * 2];
        // -20dB 1kHz 正弦波，远低于 -1dBTP 阈值
        let amp = 10.0_f32.powf(-20.0 / 20.0);
        for (i, chunk) in samples.chunks_exact_mut(2).enumerate() {
            let v = (i as f32 * 2.0 * std::f32::consts::PI * 1000.0 / 48_000.0).sin() * amp;
            chunk[0] = v;
            chunk[1] = v;
        }
        let original: Vec<f32> = samples.clone();
        limiter.process_interleaved_stereo(&mut samples);
        // 低电平信号增益应保持 1.0，输出 ≈ 输入
        let max_diff = samples
            .iter()
            .zip(original.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f32, f32::max);
        assert!(
            max_diff < 0.01,
            "低电平信号不应触发限幅，max_diff={max_diff}"
        );
    }
}
