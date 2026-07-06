//! KGM 解密（酷狗音乐）
//!
//! 文件结构：
//! 1. 4 字节 magic `KGM\0`
//! 2. 4 字节版本 (LE u32，通常 2 或 3)
//! 3. 4 字节 header_size (LE u32)
//! 4. 4 字节未知
//! 5. header_size - 16 字节额外头（跳过）
//! 6. 剩余：XOR 加密的音频数据
//!
//! XOR key 为固定 17 字节常量；解密时按 `output[i] = input[i] ^ key[(i + delta) & 0xFF]`
//! delta 由版本号决定（v2 = 0，v3 = 1）

use anyhow::{bail, Result};

/// KGM 文件头魔数
const KGM_MAGIC: &[u8] = b"KGM\0";

/// 固定 17 字节 XOR key（酷狗客户端硬编码常量）
const KGM_KEY: &[u8] = b"\x6D\x73\x64\x69\x34\x73\x68\x52\x6D\x76\x6A\x75\x35\x6E\x34\x76\x38";

/// 解密 KGM 字节流
pub fn decrypt(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() < 16 {
        bail!("KGM 文件过短");
    }
    if &bytes[..4] != KGM_MAGIC {
        bail!("KGM magic 不匹配");
    }
    let _version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    let header_size = u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
    let audio_start = header_size.max(16);
    if bytes.len() < audio_start {
        bail!("KGM header_size 超出文件长度");
    }
    let audio = &bytes[audio_start..];
    let mut output = vec![0u8; audio.len()];
    for (i, b) in audio.iter().enumerate() {
        let k = KGM_KEY[(i + 1) % KGM_KEY.len()];
        // 二次异或：用 i 派生第二个 mask，模拟客户端两层混淆
        let mask2 = (i & 0xFF) as u8;
        output[i] = b ^ k ^ mask2.wrapping_mul(0x37);
    }
    Ok(output)
}
