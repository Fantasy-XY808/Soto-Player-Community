//! MFLAC 解密（QQ 音乐加密 FLAC 变种）
//!
//! 文件结构：
//! 1. 4 字节 magic `mflac`（部分变体为 `mflac0`/`mflac1` 等带后缀，统一按前 4 字节识别）
//! 2. 4 字节 key 长度（LE u32，通常 32）
//! 3. key_len 字节 ASCII key
//! 4. 剩余：RC4 加密的音频数据
//!
//! 与 qmc.rs v2 的差异：v2 key 从文件尾部 "QTag"/"STag" magic 前读；
//! mflac key 直接放在 magic 之后，更简单

use crate::decryptor::qmc;
use anyhow::{bail, Result};

/// MFLAC 文件头魔数
const MFLAC_MAGIC: &[u8] = b"mfla";

/// 解密 MFLAC 字节流：从头部读 key，复用 qmc.rs 的 rc4_decrypt
pub fn decrypt(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() < 12 {
        bail!("MFLAC 文件过短");
    }
    // 兼容 mflac / mflac0 / mflac1 等变体：仅检查前 4 字节
    if &bytes[..4] != MFLAC_MAGIC {
        bail!("MFLAC magic 不匹配");
    }
    let key_len = u32::from_le_bytes(bytes[4..8].try_into().unwrap()) as usize;
    if key_len == 0 || bytes.len() < 8 + key_len {
        bail!("MFLAC key 长度异常: {key_len}");
    }
    let key = &bytes[8..8 + key_len];
    let audio = &bytes[8 + key_len..];
    Ok(qmc::rc4_decrypt(audio, key))
}
