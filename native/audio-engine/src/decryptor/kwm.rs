//! KWM 解密（酷我音乐）
//!
//! 文件结构：
//! 1. 4 字节 magic `kwm\x00`（早期版本）或全 0
//! 2. 4 字节版本/flags
//! 3. 4 字节 unknown
//! 4. 4 字节 unknown
//! 5. 剩余：XOR 加密的音频数据
//!
//! XOR key：固定 32 字节常量循环异或；与 unlock-music 项目公开实现一致

use anyhow::{bail, Result};

/// KWM 文件头魔数（早期版本是 `kwm\x00`，部分版本是 `\x00\x00\x00\x00`）
const KWM_MAGIC: &[u8] = b"kwm\x00";

/// 固定 32 字节 XOR key（酷我客户端硬编码常量）
const KWM_KEY: [u8; 32] = [
    0xD6, 0x48, 0x65, 0xDC, 0x72, 0xC9, 0x5D, 0xDC, 0x6D, 0x28, 0x96, 0x8C, 0x6D, 0x28, 0x96,
    0x8C, 0xD6, 0x48, 0x65, 0xDC, 0x72, 0xC9, 0x5D, 0xDC, 0x6D, 0x28, 0x96, 0x8C, 0x6D, 0x28,
    0x96, 0x8C,
];

/// 解密 KWM 字节流
pub fn decrypt(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() < 16 {
        bail!("KWM 文件过短");
    }
    // magic 兼容：部分版本头部为 `kwm\x00`，部分为全 0
    if &bytes[..4] != KWM_MAGIC && bytes[..4] != [0, 0, 0, 0] {
        bail!("KWM magic 不匹配");
    }
    let audio = &bytes[16..];
    let mut output = vec![0u8; audio.len()];
    for (i, b) in audio.iter().enumerate() {
        output[i] = b ^ KWM_KEY[i & 0x1F];
    }
    Ok(output)
}
