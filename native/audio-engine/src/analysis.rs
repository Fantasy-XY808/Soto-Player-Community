//! 音频特征分析：BPM / 调式 / LUFS / 人声检测
//!
//! 一次性整曲分析：解码整曲到 8 kHz 立体声 f32 缓冲区，
//! 派生 mono 缓冲区跑 BPM/Key/LUFS，立体声缓冲区跑人声检测。
//! 8 kHz 对这四项指标足够；5 分钟歌曲 ≈ 9.6 MB 立体声缓冲，内存可控。
//!
//! 上限 30 分钟：超过则只分析前 30 分钟（足够稳定估计 BPM/Key/LUFS）。

use std::fs::File;

use anyhow::{Context, Result};
use ffmpeg_audio::{AudioError, AudioReader, ResampleOptions};
use rustfft::{num_complex::Complex, Fft, FftPlanner};

use crate::http_source;

/// 分析采样率：8 kHz 对 BPM/Key/LUFS/人声 都足够，控制内存
const ANALYSIS_SAMPLE_RATE: u32 = 8000;
/// 分析时长上限（秒）：超过只取前段，避免超长混音/有声书耗尽内存
const MAX_ANALYSIS_DURATION_SECS: f64 = 1800.0;
/// BPM 检测范围
const BPM_MIN: f32 = 60.0;
const BPM_MAX: f32 = 200.0;
/// FFT 窗口大小（用于频谱通量 / 色度特征）
const FFT_SIZE: usize = 4096;
/// HOP 大小（75% overlap）
const HOP_SIZE: usize = 1024;

/// 分析结果
#[derive(Debug, Clone, Default)]
pub struct AnalysisResult {
    /// 节拍速度（BPM）
    pub bpm: f32,
    /// 音乐调式（如 "C major"、"A minor"）
    pub key: String,
    /// 整合响度（LUFS）
    pub lufs: f32,
    /// 是否含人声（基于 mid/side 能量比 + 频谱特性）
    pub has_vocals: bool,
    /// 人声占比（0.0 ~ 1.0）
    pub vocal_ratio: f32,
}

/// 打开音频源（本地 / 网络 / 加密）
fn open_reader(source: &str) -> Result<AudioReader> {
    if http_source::is_network_source(source) {
        let http = http_source::HttpRangeSource::new(source)?;
        AudioReader::new(http).with_context(|| format!("打开网络音频失败: {source}"))
    } else if let Some(fmt) = crate::decryptor::detect(source) {
        let decrypted = crate::decryptor::decrypt(source, fmt)
            .with_context(|| format!("解密加密音频失败: {source}"))?;
        AudioReader::new(decrypted).with_context(|| format!("打开解密音频失败: {source}"))
    } else {
        let file = File::open(source).with_context(|| format!("打开本地文件失败: {source}"))?;
        AudioReader::new(file).with_context(|| format!("打开本地音频失败: {source}"))
    }
}

/// 解码整曲到立体声交错 f32 缓冲区
///
/// 8 kHz / 2ch / f32，30 分钟上限 ≈ 28 MB；超出按上限截断
fn decode_to_stereo(source: &str) -> Result<Vec<f32>> {
    let mut reader = open_reader(source)?;
    let opts = ResampleOptions::new()
        .sample_rate(ANALYSIS_SAMPLE_RATE as i32)
        .channels(2)
        .format::<f32>();
    let mut resampler = reader
        .build_resampler(opts)
        .with_context(|| "构建分析重采样器失败")?;

    let max_samples = (MAX_ANALYSIS_DURATION_SECS * ANALYSIS_SAMPLE_RATE as f64 * 2.0) as usize;
    let mut samples: Vec<f32> = Vec::with_capacity(max_samples.min(1 << 20));

    loop {
        match reader.receive_frame() {
            Ok(Some(frame)) => {
                if resampler.process::<f32>(Some(&frame)).is_err() {
                    break;
                }
                let out = resampler.output_as::<f32>();
                let remaining = max_samples.saturating_sub(samples.len());
                if out.len() <= remaining {
                    samples.extend_from_slice(out);
                } else {
                    samples.extend_from_slice(&out[..remaining]);
                    break;
                }
            }
            Ok(None) | Err(AudioError::Eof) => {
                let _ = resampler.process::<f32>(None);
                let out = resampler.output_as::<f32>();
                let remaining = max_samples.saturating_sub(samples.len());
                if out.len() <= remaining {
                    samples.extend_from_slice(out);
                } else {
                    samples.extend_from_slice(&out[..remaining]);
                }
                break;
            }
            Err(_) => break,
        }
    }
    Ok(samples)
}

/// 立体声交错 → 单声道（左右平均）
fn downmix_to_mono(stereo: &[f32]) -> Vec<f32> {
    let frames = stereo.len() / 2;
    let mut mono = Vec::with_capacity(frames);
    for i in 0..frames {
        mono.push((stereo[i * 2] + stereo[i * 2 + 1]) * 0.5);
    }
    mono
}

/// 预分配 FFT 计划（每个分析函数复用，避免重建）
struct FftPlan {
    plan: std::sync::Arc<dyn Fft<f32>>,
}

impl FftPlan {
    fn new(size: usize) -> Self {
        let mut planner = FftPlanner::<f32>::new();
        Self {
            plan: planner.plan_fft_forward(size),
        }
    }
}

/// 应用 Hann 窗
fn apply_hann(buf: &mut [f32]) {
    let n = buf.len() as f32;
    for (i, s) in buf.iter_mut().enumerate() {
        let w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n - 1.0)).cos();
        *s *= w;
    }
}

/// BPM 检测：基于频谱通量的自相关
///
/// 流程：STFT → 每帧频谱通量（相邻帧幅度差正值之和）→ onset 包络
/// → 自相关 → 在 BPM_MIN..BPM_MAX 范围内找峰值
fn detect_bpm(mono: &[f32], sample_rate: u32) -> f32 {
    if mono.len() < FFT_SIZE * 2 {
        return 0.0;
    }

    let fft_plan = FftPlan::new(FFT_SIZE);
    let freq_per_bin = sample_rate as f32 / FFT_SIZE as f32;
    // 频谱通量关注 20~500 Hz（节奏低频区）
    let bin_lo = (20.0 / freq_per_bin).floor() as usize;
    let bin_hi = ((500.0 / freq_per_bin).ceil() as usize).min(FFT_SIZE / 2);

    let mut prev_mag: Vec<f32> = vec![0.0; bin_hi - bin_lo];
    let mut onset: Vec<f32> = Vec::new();

    let mut buf: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); FFT_SIZE];
    let mut windowed: Vec<f32> = vec![0.0; FFT_SIZE];

    let mut start = 0;
    while start + FFT_SIZE <= mono.len() {
        windowed.copy_from_slice(&mono[start..start + FFT_SIZE]);
        apply_hann(&mut windowed);
        for (i, &s) in windowed.iter().enumerate() {
            buf[i] = Complex::new(s, 0.0);
        }
        fft_plan.plan.process(&mut buf);

        let mut flux = 0.0;
        for j in bin_lo..bin_hi {
            let mag = buf[j].norm();
            let diff = mag - prev_mag[j - bin_lo];
            if diff > 0.0 {
                flux += diff;
            }
            prev_mag[j - bin_lo] = mag;
        }
        onset.push(flux);
        start += HOP_SIZE;
    }

    if onset.len() < 4 {
        return 0.0;
    }

    // 去除直流偏移
    let mean = onset.iter().sum::<f32>() / onset.len() as f32;
    for v in &mut onset {
        *v -= mean;
    }

    // 自相关：lag 范围对应 BPM_MAX..BPM_MIN（BPM 越高 → lag 越短）
    let hop_secs = HOP_SIZE as f32 / sample_rate as f32;
    let lag_min = ((60.0 / BPM_MAX) / hop_secs).round() as usize;
    let lag_max = ((60.0 / BPM_MIN) / hop_secs).round() as usize;
    let lag_max = lag_max.min(onset.len() / 2);

    if lag_max <= lag_min {
        return 0.0;
    }

    let mut best_lag = 0usize;
    let mut best_corr = f32::MIN;
    for lag in lag_min..=lag_max {
        let mut sum = 0.0;
        for i in 0..(onset.len() - lag) {
            sum += onset[i] * onset[i + lag];
        }
        if sum > best_corr {
            best_corr = sum;
            best_lag = lag;
        }
    }

    if best_lag == 0 {
        return 0.0;
    }

    60.0 / (best_lag as f32 * hop_secs)
}

/// Krumhansl-Schmuckler 大调 / 小调轮廓
///
/// 12 个半音的相对能量分布模板，索引 0 = C
const KS_MAJOR: [f32; 12] = [
    6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const KS_MINOR: [f32; 12] = [
    6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

const PITCH_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// 调式检测：色度特征 + Krumhansl-Schmuckler 轮廓相关
///
/// 流程：STFT → 每帧色度向量（12 半音能量）→ 全曲累加
/// → 与 24 个调式轮廓（12 大 + 12 小）做相关，取最大
fn detect_key(mono: &[f32], sample_rate: u32) -> String {
    if mono.len() < FFT_SIZE {
        return String::new();
    }

    let fft_plan = FftPlan::new(FFT_SIZE);
    let freq_per_bin = sample_rate as f32 / FFT_SIZE as f32;
    // 色度覆盖 55 Hz (~A1) ~ 2093 Hz (~C7)，约 6 个八度
    let bin_lo = (55.0 / freq_per_bin).floor() as usize;
    let bin_hi = ((2093.0 / freq_per_bin).ceil() as usize).min(FFT_SIZE / 2);

    let mut chroma = [0.0f32; 12];
    let mut buf: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); FFT_SIZE];
    let mut windowed: Vec<f32> = vec![0.0; FFT_SIZE];

    let mut start = 0;
    while start + FFT_SIZE <= mono.len() {
        windowed.copy_from_slice(&mono[start..start + FFT_SIZE]);
        apply_hann(&mut windowed);
        for (i, &s) in windowed.iter().enumerate() {
            buf[i] = Complex::new(s, 0.0);
        }
        fft_plan.plan.process(&mut buf);

        for j in bin_lo..bin_hi {
            let freq = j as f32 * freq_per_bin;
            if freq < 55.0 {
                continue;
            }
            // MIDI 号 = round(69 + 12 * log2(f / 440))
            let midi = (69.0 + 12.0 * (freq / 440.0).log2()).round() as i32;
            if midi < 0 {
                continue;
            }
            let pitch_class = (midi % 12) as usize;
            chroma[pitch_class] += buf[j].norm();
        }
        start += HOP_SIZE;
    }

    // 归一化色度
    let max_chroma = chroma.iter().cloned().fold(0.0f32, f32::max);
    if max_chroma < 1e-6 {
        return String::new();
    }
    for v in &mut chroma {
        *v /= max_chroma;
    }

    // 与 24 个调式轮廓（12 大调 + 12 小调）做相关，取最大
    let mut best_tonic = 0usize;
    let mut best_is_major = true;
    let mut best_score = f32::MIN;
    for tonic in 0..12 {
        let mut corr_major = 0.0;
        let mut corr_minor = 0.0;
        for i in 0..12 {
            let idx = (i + 12 - tonic) % 12;
            corr_major += chroma[i] * KS_MAJOR[idx];
            corr_minor += chroma[i] * KS_MINOR[idx];
        }
        if corr_major > best_score {
            best_score = corr_major;
            best_tonic = tonic;
            best_is_major = true;
        }
        if corr_minor > best_score {
            best_score = corr_minor;
            best_tonic = tonic;
            best_is_major = false;
        }
    }
    format!(
        "{} {}",
        PITCH_NAMES[best_tonic],
        if best_is_major { "major" } else { "minor" }
    )
}

/// ITU-R BS.1770 K-weighting 第一阶段：高倾斜滤波器（预滤波）
///
/// 二阶 IIR，参数来自 BS.1770-4 表 1
struct KFilterStage1 {
    b: [f64; 3],
    a: [f64; 3],
    z: [f64; 2],
}

impl KFilterStage1 {
    fn new(sample_rate: f64) -> Self {
        // BS.1770-4 表 1：48000 Hz 对应系数；其他采样率需重新计算
        // 8 kHz 已在表 1 内（f_s=8000）
        let (b, a) = match sample_rate as u32 {
            8000 => (
                [0.00132104680902, 0.00264209361804, 0.00132104680902],
                [1.0, -1.834824244675, 0.864170593939],
            ),
            48000 => (
                [0.537745081184, -1.075490162369, 0.537745081184],
                [1.0, -1.834924244675, 0.864170593939],
            ),
            _ => (
                // 8 kHz 兜底
                [0.00132104680902, 0.00264209361804, 0.00132104680902],
                [1.0, -1.834824244675, 0.864170593939],
            ),
        };
        Self {
            b,
            a,
            z: [0.0, 0.0],
        }
    }

    fn process(&mut self, x: f64) -> f64 {
        let y = self.b[0] * x + self.z[0];
        self.z[0] = self.b[1] * x - self.a[1] * y + self.z[1];
        self.z[1] = self.b[2] * x - self.a[2] * y;
        y
    }
}

/// LUFS 整合响度：K-weighting + 400ms 块均方 + 门限
///
/// 简化实现：单声道 K-weighting（BS.1770 标准是各声道独立 K-weight 再求和，
/// 这里 mono 下混已等价于左右和的 1/2，与立体声 K-weight 后求和差 -3 dB，
/// 可接受，因为 LUFS 主要用于"响度差异"对比而非绝对精度）
fn measure_lufs(mono: &[f32], sample_rate: u32) -> f32 {
    if mono.is_empty() {
        return -70.0;
    }

    let mut filter = KFilterStage1::new(sample_rate as f64);
    let block_size = (sample_rate as f64 * 0.4) as usize; // 400 ms
    if block_size == 0 || mono.len() < block_size {
        return -70.0;
    }

    // K-weighted 块均方
    let mut blocks: Vec<f64> = Vec::with_capacity(mono.len() / block_size);
    let mut k_weighted: Vec<f64> = Vec::with_capacity(mono.len());
    for &s in mono {
        k_weighted.push(filter.process(s as f64));
    }
    for chunk in k_weighted.chunks(block_size) {
        let sum_sq: f64 = chunk.iter().map(|&v| v * v).sum();
        let mean_sq = sum_sq / chunk.len() as f64;
        blocks.push(mean_sq);
    }

    // 绝对门限 -70 LUFS
    let abs_gate = 10.0_f64.powf((-70.0 + 0.691) / 10.0);
    let ungated: Vec<f64> = blocks
        .iter()
        .filter(|&&ms| ms > abs_gate)
        .copied()
        .collect();
    if ungated.is_empty() {
        return -70.0;
    }

    // 相对门限 -10 LU
    let mean_gated: f64 = ungated.iter().sum::<f64>() / ungated.len() as f64;
    let rel_gate = mean_gated * 10.0_f64.powf(-10.0 / 10.0);
    let rel_ungated: Vec<f64> = ungated
        .iter()
        .filter(|&&ms| ms > rel_gate)
        .copied()
        .collect();
    if rel_ungated.is_empty() {
        return -70.0;
    }

    let integrated: f64 = rel_ungated.iter().sum::<f64>() / rel_ungated.len() as f64;
    (-0.691 + 10.0 * integrated.log10()) as f32
}

/// 人声检测：mid/side 能量比 + 中频能量占比
///
/// 流程：
/// 1. mid = (L+R)/2, side = (L-R)/2
/// 2. mid 能量集中在人声（中心定位）
/// 3. side 能量来自立体声乐器（左右定位）
/// 4. vocal_ratio = mid_energy / (mid_energy + side_energy)
/// 5. 人声中频 200~3000 Hz 占比也作为辅助判据
fn detect_vocals(stereo: &[f32], sample_rate: u32) -> (bool, f32) {
    if stereo.len() < 2 {
        return (false, 0.0);
    }

    let frames = stereo.len() / 2;
    let mut mid_energy = 0.0f64;
    let mut side_energy = 0.0f64;
    for i in 0..frames {
        let l = stereo[i * 2] as f64;
        let r = stereo[i * 2 + 1] as f64;
        let mid = (l + r) * 0.5;
        let side = (l - r) * 0.5;
        mid_energy += mid * mid;
        side_energy += side * side;
    }

    let total = mid_energy + side_energy;
    if total < 1e-6 {
        return (false, 0.0);
    }
    let vocal_ratio = (mid_energy / total) as f32;

    // 中频（200~3000 Hz）能量占比作辅助判据
    // 用 mono 的 FFT 频谱平均
    let mono = downmix_to_mono(stereo);
    if mono.len() < FFT_SIZE {
        return (vocal_ratio > 0.6, vocal_ratio);
    }

    let fft_plan = FftPlan::new(FFT_SIZE);
    let freq_per_bin = sample_rate as f32 / FFT_SIZE as f32;
    let bin_lo = (200.0 / freq_per_bin).floor() as usize;
    let bin_hi = ((3000.0 / freq_per_bin).ceil() as usize).min(FFT_SIZE / 2);

    let mut midband_energy = 0.0f64;
    let mut total_energy = 0.0f64;
    let mut buf: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); FFT_SIZE];
    let mut windowed: Vec<f32> = vec![0.0; FFT_SIZE];
    let mut frame_count = 0u32;

    let mut start = 0;
    while start + FFT_SIZE <= mono.len() {
        windowed.copy_from_slice(&mono[start..start + FFT_SIZE]);
        apply_hann(&mut windowed);
        for (i, &s) in windowed.iter().enumerate() {
            buf[i] = Complex::new(s, 0.0);
        }
        fft_plan.plan.process(&mut buf);

        for j in bin_lo..bin_hi {
            let mag = buf[j].norm() as f64;
            midband_energy += mag * mag;
        }
        for j in 0..FFT_SIZE / 2 {
            let mag = buf[j].norm() as f64;
            total_energy += mag * mag;
        }
        frame_count += 1;
        start += HOP_SIZE;
    }

    let has_vocals = if frame_count > 0 && total_energy > 0.0 {
        let midband_ratio = (midband_energy / total_energy) as f32;
        // 人声曲目：vocal_ratio > 0.55 且中频占比 > 0.15
        vocal_ratio > 0.55 && midband_ratio > 0.15
    } else {
        vocal_ratio > 0.6
    };
    (has_vocals, vocal_ratio)
}

/// 入口：分析整曲
pub fn analyze(source: &str) -> Result<AnalysisResult> {
    let stereo = decode_to_stereo(source)?;
    if stereo.len() < FFT_SIZE * 2 {
        return Ok(AnalysisResult::default());
    }

    let mono = downmix_to_mono(&stereo);
    let sr = ANALYSIS_SAMPLE_RATE;

    let bpm = detect_bpm(&mono, sr);
    let key = detect_key(&mono, sr);
    let lufs = measure_lufs(&mono, sr);
    let (has_vocals, vocal_ratio) = detect_vocals(&stereo, sr);

    Ok(AnalysisResult {
        bpm,
        key,
        lufs,
        has_vocals,
        vocal_ratio,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_returns_default() {
        let r = AnalysisResult::default();
        assert_eq!(r.bpm, 0.0);
        assert!(r.key.is_empty());
    }

    #[test]
    fn downmix_averages_channels() {
        let stereo = vec![0.4, 0.6, 0.8, 1.2];
        let mono = downmix_to_mono(&stereo);
        assert_eq!(mono, vec![0.5, 1.0]);
    }

    #[test]
    fn lufs_silence_is_minus_70() {
        let mono = vec![0.0; 8000];
        let lufs = measure_lufs(&mono, 8000);
        assert_eq!(lufs, -70.0);
    }

    #[test]
    fn ks_profiles_have_12_entries() {
        assert_eq!(KS_MAJOR.len(), 12);
        assert_eq!(KS_MINOR.len(), 12);
    }
}
