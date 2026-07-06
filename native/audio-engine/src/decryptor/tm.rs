//! TM 解密（TideMusic）
//!
//! 简单 XOR：固定 8 字节 key 循环异或
//! 无文件头 magic，整文件均为加密音频数据

use anyhow::{bail, Result};

/// 固定 8 字节 XOR key（TideMusic 客户端硬编码常量）
const TM_KEY: [u8; 8] = [0x35, 0xD4, 0x0B, 0x6E, 0x9C, 0x7A, 0x82, 0x27];

/// 解密 TM 字节流：8 字节 key 循环异或
pub fn decrypt(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.is_empty() {
        bail!("TM 文件为空");
    }
    let mut output = vec![0u8; bytes.len()];
    for (i, b) in bytes.iter().enumerate() {
        output[i] = b ^ TM_KEY[i & 0x07];
    }
    Ok(output)
}
