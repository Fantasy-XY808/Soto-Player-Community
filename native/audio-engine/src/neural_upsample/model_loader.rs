//! 神经网络上采样 ONNX 模型加载与推理
//!
//! 模型搜索路径：用户在 UI 上指定，IPC handler 读取 `{userData}/app-data/models/`
//! 目录下的 `super_res.onnx`。加载失败（文件不存在 / ort 初始化失败）时返回 Err，
//! 调用方按"无模型"处理（回退到 mod.rs 的带宽外推兜底，而非直通）。
//!
//! 当前阶段：仅校验文件存在性，不真正创建 ort session。
//! `infer()` 提供占位实现（线性插值上采样 + 高频补偿），让模型加载后立即生效，
//! 而非空跑导致超分开关形同虚设。

use std::path::Path;

/// 占位推理：相邻样本差分混合强度（25%）
const PLACEHOLDER_STRENGTH: f32 = 0.25;
/// 占位推理：差分软饱和驱动强度（产生高频谐波）
const PLACEHOLDER_DRIVE: f32 = 2.0;

/// 已加载的 ONNX 模型封装
/// 当前阶段：仅持有路径，`infer()` 用占位 DSP 实现超分听感
pub struct NeuralModel {
    #[allow(dead_code)]
    pub path: String,
}

/// 在指定路径加载 ONNX 模型
/// 路径不存在 / 文件不可读时返回 Err
///
/// 当前阶段：仅校验文件存在性，不真正创建 ort session
pub fn load_model(path: &str) -> Result<NeuralModel, String> {
    let p = Path::new(path);
    if !p.exists() {
        return Err(format!("模型文件不存在: {path}"));
    }
    match std::fs::File::open(p) {
        Ok(_) => Ok(NeuralModel::new(path.to_string())),
        Err(e) => Err(format!("无法读取模型文件: {e}")),
    }
}

impl NeuralModel {
    /// 创建模型封装
    /// 当前阶段：仅记录路径
    pub fn new(path: String) -> Self {
        Self { path }
    }

    /// 占位推理：线性插值上采样 + 高频补偿
    ///
    /// 真实 2x 上采样需要扩展样本数量并改 Sink 采样率，超出当前框架范围。
    /// 此处用 DSP 兜底模拟超分听感，保持原地修改契约：
    /// 1. 相邻样本差分 ≈ 线性插值上采样后的"中间点偏移"，本质是高频成分
    /// 2. 对差分做 tanh 软饱和生成谐波（高频补偿，模拟缺失的高频细节）
    /// 3. 加权混合回原信号，让超分开关有可感的听效
    ///
    /// 与 mod.rs 的带宽外推兜底互补：带宽外推生成"全新的高频"，
    /// 此处在原信号基础上"锐化已有的高频过渡"
    pub fn infer(&self, samples: &mut [f32]) {
        if samples.len() < 2 {
            return;
        }
        let mut prev = samples[0];
        for s in samples.iter_mut().skip(1) {
            let diff = *s - prev;
            prev = *s;
            let harmonics = (diff * PLACEHOLDER_DRIVE).tanh();
            *s += harmonics * PLACEHOLDER_STRENGTH;
        }
    }
}
