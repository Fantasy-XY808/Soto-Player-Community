use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use rodio::Source;

use crate::bass_enhancer::BassEnhancer;
use crate::equalizer::Equalizer;
use crate::fft::FftAnalyzer;
use crate::loudness_normalizer::LoudnessNormalizer;
use crate::neural_upsample::NeuralUpsample;
use crate::shared::Shared;
use crate::stereo_widener::StereoWidener;
use crate::super_resolution::SuperResolution;
use crate::tempo::StretchProcessor;

/// rodio 音频源，从共享缓冲区拉取样本。
/// 使用 condvar 阻塞等待数据，不会返回静音填充。
pub struct DecoderSource {
    shared: Arc<Shared>,
    fft: Arc<FftAnalyzer>,
    /// 跨曲目共享的均衡器，load/seek 时通过 Arc::clone 传入
    equalizer: Arc<Mutex<Equalizer>>,
    /// 跨曲目共享的变速变调处理器，load/seek 时通过 Arc::clone 传入
    tempo: Arc<Mutex<StretchProcessor>>,
    /// 跨曲目共享的音频超分处理器，load/seek 时通过 Arc::clone 传入
    /// 关闭时零开销 early return；DSP 链位置：EQ 之后、bass_enhancer 之前
    super_res: Arc<SuperResolution>,
    /// 跨曲目共享的低音增强处理器
    /// DSP 链位置：super_res 之后、stereo_widener 之前
    bass_enhancer: Arc<BassEnhancer>,
    /// 跨曲目共享的立体声展宽处理器
    /// DSP 链位置：bass_enhancer 之后、loudness_normalizer 之前
    stereo_widener: Arc<StereoWidener>,
    /// 跨曲目共享的响度归一化处理器
    /// DSP 链位置：stereo_widener 之后、tempo 之前；用于多 DSP 串联后防止削波
    loudness_normalizer: Arc<LoudnessNormalizer>,
    /// 跨曲目共享的神经网络上采样处理器
    /// DSP 链位置：loudness_normalizer 之后、tempo 之前；当前框架阶段（无模型时直通）
    neural_upsample: Arc<NeuralUpsample>,
    /// 本地缓冲，减少锁竞争
    local_buffer: VecDeque<f32>,
    /// stretch 输出复用缓冲（避免每帧分配）
    tempo_scratch: Vec<f32>,
    sample_rate: u32,
    channels: u16,
}

impl DecoderSource {
    pub fn new(
        shared: Arc<Shared>,
        fft: Arc<FftAnalyzer>,
        equalizer: Arc<Mutex<Equalizer>>,
        tempo: Arc<Mutex<StretchProcessor>>,
        super_res: Arc<SuperResolution>,
        bass_enhancer: Arc<BassEnhancer>,
        stereo_widener: Arc<StereoWidener>,
        loudness_normalizer: Arc<LoudnessNormalizer>,
        neural_upsample: Arc<NeuralUpsample>,
        sample_rate: u32,
        channels: u16,
    ) -> Self {
        Self {
            shared,
            fft,
            equalizer,
            tempo,
            super_res,
            bass_enhancer,
            stereo_widener,
            loudness_normalizer,
            neural_upsample,
            local_buffer: VecDeque::new(),
            tempo_scratch: Vec::new(),
            sample_rate,
            channels,
        }
    }
}

impl Iterator for DecoderSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        // 快速路径：从本地缓冲返回（无原子操作）
        if let Some(sample) = self.local_buffer.pop_front() {
            return Some(sample);
        }

        // 慢速路径：从共享缓冲区阻塞获取，跳过空数据块
        loop {
            if let Some(chunk) = self.shared.pop() {
                // 将 FFT 样本推送给分析器
                if !chunk.fft_samples.is_empty() {
                    self.fft.push_samples(&chunk.fft_samples);
                }

                // 填充本地缓冲，一次性批量计数（而非逐样本）
                if !chunk.player_samples.is_empty() {
                    let mut samples = chunk.player_samples;
                    // 对整 chunk 应用 EQ：每秒只锁 50~100 次，开销摊到几千个样本上
                    self.equalizer
                        .lock()
                        .process_interleaved_stereo(&mut samples);
                    // 超分（高频激励器）：关闭时 early return，开启时按声道应用
                    // 高通 + cubic soft clip + 湿混合；DSP 链第 2 级（EQ 之后）
                    self.super_res.process_interleaved_stereo(&mut samples);
                    // 低音增强：low-shelf + 软饱和；DSP 链第 3 级（super_res 之后）
                    self.bass_enhancer.process_interleaved_stereo(&mut samples);
                    // 立体声展宽：Mid-Side 处理；DSP 链第 4 级（bass_enhancer 之后）
                    self.stereo_widener.process_interleaved_stereo(&mut samples);
                    // 响度归一化：滑动窗口 RMS + 增益调整；DSP 链第 5 级（stereo_widener 之后、neural_upsample 之前）
                    self.loudness_normalizer.process_interleaved_stereo(&mut samples);
                    // 神经网络上采样：框架阶段无模型时直通；DSP 链第 6 级（loudness_normalizer 之后、tempo 之前）
                    self.neural_upsample.process_interleaved_stereo(&mut samples);
                    // 源时间长度（按输入计数，与 speed 无关；让 consumed_position 反映源进度）
                    let source_count = samples.len() as u64;
                    // 变速变调（bypass 时直接 extend，零开销）
                    self.tempo_scratch.clear();
                    self.tempo.lock().process(&samples, &mut self.tempo_scratch);
                    if !self.tempo_scratch.is_empty() {
                        self.local_buffer.extend(self.tempo_scratch.drain(..));
                    }
                    self.shared.advance_consumed(source_count);
                    // stretch 在预热期可能本帧没产出，没样本就继续拉下一块
                    let Some(s) = self.local_buffer.pop_front() else {
                        continue;
                    };
                    return Some(s);
                }
                // 空数据块（重采样器预热期），继续获取下一个
            } else {
                // 数据源耗尽，标记消费完毕
                self.shared.mark_all_consumed();
                return None;
            }
        }
    }
}

impl Source for DecoderSource {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> u16 {
        self.channels
    }

    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    fn total_duration(&self) -> Option<Duration> {
        None
    }
}
