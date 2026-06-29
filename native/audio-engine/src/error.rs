//! 业务错误枚举，用于在 NAPI 边界把内部 anyhow::Error 分类成 JS 可识别的类型。
//!
//! 内部代码继续用 anyhow，只在 IntoNapiResult 转换时按错误链文本做启发式分类。
//! 这层不是完整的 typed error 体系，而是 JS 侧可以 `if (err.code === "NetworkUnreachable")` 的薄封装

use thiserror::Error;

/// 暴露给 JS 侧的错误分类
#[derive(Error, Debug)]
pub enum AudioEngineError {
    /// 网络不可达：DNS 失败、连接超时、socket 错误等
    #[error("network unreachable: {0}")]
    NetworkUnreachable(String),

    /// 音源不存在：404、本地文件不存在等
    #[error("source not found: {0}")]
    SourceNotFound(String),

    /// 解码失败：FFmpeg 报错、格式不支持、文件损坏
    #[error("decode failed: {0}")]
    DecodeFailed(String),

    /// 音频输出设备故障
    #[error("audio device error: {0}")]
    Device(String),

    /// 取消（cancel flag 被设置）
    #[error("operation cancelled")]
    Cancelled,

    /// 其它未分类错误
    #[error("{0}")]
    Other(String),
}

impl AudioEngineError {
    /// 错误码，给 JS 侧用于分支判断
    pub fn code(&self) -> &'static str {
        match self {
            Self::NetworkUnreachable(_) => "NetworkUnreachable",
            Self::SourceNotFound(_) => "SourceNotFound",
            Self::DecodeFailed(_) => "DecodeFailed",
            Self::Device(_) => "Device",
            Self::Cancelled => "Cancelled",
            Self::Other(_) => "Other",
        }
    }

    /// 启发式分类：从 anyhow 错误链的拼接文本里猜分类。
    /// 不能精确，但比纯 stringify 多一层信号，避免大改全部错误站点
    pub fn classify(err: &anyhow::Error) -> Self {
        let full = format!("{err:#}").to_ascii_lowercase();
        if full.contains("cancel") || full.contains("interrupted") {
            Self::Cancelled
        } else if full.contains("404")
            || full.contains("not found")
            || full.contains("no such file")
        {
            Self::SourceNotFound(full)
        } else if full.contains("network")
            || full.contains("dns")
            || full.contains("connect")
            || full.contains("timeout")
            || full.contains("transport")
        {
            Self::NetworkUnreachable(full)
        } else if full.contains("decode")
            || full.contains("ffmpeg")
            || full.contains("invalid data")
        {
            Self::DecodeFailed(full)
        } else if full.contains("device") || full.contains("audio output") || full.contains("cpal")
        {
            Self::Device(full)
        } else {
            Self::Other(full)
        }
    }
}
