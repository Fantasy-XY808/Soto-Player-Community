//! unlock-music 本地解密
//!
//! 支持 6 种加密格式：NCM (网易云) / QMC (QQ 音乐) / KGM (酷狗) / KWM (酷我) / MFLAC / TM
//! 在 decoder/scanner 调用 `detect` + `decrypt` 后，返回的 `DecryptedSource` 实现 `Read + Seek`，
//! 可直接喂给 `AudioReader::new`，FFmpeg 从解密后的字节流自动识别 MP3/FLAC 等容器格式
//!
//! 设计权衡：解密在主线程同步执行（仅本地文件、单文件几 MB ~ 几十 MB）；
//! 网络源不走解密路径（流媒体协议已有鉴权，无加密文件场景）

pub mod kgm;
pub mod kwm;
pub mod mflac;
pub mod ncm;
pub mod qmc;
pub mod tm;

use std::io::{Cursor, Read, Seek, SeekFrom};
use std::path::Path;

use anyhow::{Context, Result};

/// 加密格式枚举
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EncryptionFormat {
    /// 网易云 NCM
    Ncm,
    /// QQ 音乐 QMC
    Qmc,
    /// 酷狗 KGM/KGMA
    Kgm,
    /// 酷我 KWM
    Kwm,
    /// QQ 音乐加密 FLAC (mflac)
    Mflac,
    /// TideMusic
    Tm,
}

/// 解密后的字节源：包装 `Cursor<Vec<u8>>`，实现 `Read + Seek`
pub struct DecryptedSource {
    inner: Cursor<Vec<u8>>,
}

impl Read for DecryptedSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(buf)
    }
}

impl Seek for DecryptedSource {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        self.inner.seek(pos)
    }
}

/// 按扩展名探测加密格式
///
/// 不做文件头校验：加密格式扩展名独特（ncm/qmc0/kgm 等），普通音频不会误判；
/// 误判时 decrypt 内部会因 magic 不匹配而返回错误，decoder 兜底回退到普通解码
pub fn detect(path: &str) -> Option<EncryptionFormat> {
    let p = Path::new(path);
    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
    let fmt = match ext.as_str() {
        "ncm" => EncryptionFormat::Ncm,
        "qmc0" | "qmc1" | "qmc2" | "qmc3" | "qmcflac" | "tkm" => EncryptionFormat::Qmc,
        "kgm" | "kgma" => EncryptionFormat::Kgm,
        "kwm" => EncryptionFormat::Kwm,
        "mflac" => EncryptionFormat::Mflac,
        "tm" => EncryptionFormat::Tm,
        _ => return None,
    };
    Some(fmt)
}

/// 解密入口：读取文件 → 按格式分派 → 返回 DecryptedSource
///
/// @param path - 加密文件绝对路径
/// @param fmt - 加密格式
/// @returns 解密后的字节源
pub fn decrypt(path: &str, fmt: EncryptionFormat) -> Result<DecryptedSource> {
    let bytes = std::fs::read(path).with_context(|| format!("读取加密文件失败: {path}"))?;
    let decrypted = match fmt {
        EncryptionFormat::Ncm => ncm::decrypt(&bytes)?,
        EncryptionFormat::Qmc => qmc::decrypt(&bytes)?,
        EncryptionFormat::Kgm => kgm::decrypt(&bytes)?,
        EncryptionFormat::Kwm => kwm::decrypt(&bytes)?,
        EncryptionFormat::Mflac => mflac::decrypt(&bytes)?,
        EncryptionFormat::Tm => tm::decrypt(&bytes)?,
    };
    Ok(DecryptedSource {
        inner: Cursor::new(decrypted),
    })
}
