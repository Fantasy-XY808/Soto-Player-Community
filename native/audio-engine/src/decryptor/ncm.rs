//! NCM 解密（网易云音乐）
//!
//! 文件结构：
//! 1. 8 字节 magic `CTENFDAM`
//! 2. 2 字节 gap
//! 3. 4 字节 key 长度 (LE u32)
//! 4. key_len 字节 AES-128-ECB 加密的 RC4 密钥
//!    AES key = `0x687A4852416D736F356B496E6261782F` (16 字节固定常量)
//! 5. 4 字节 metadata 长度 (LE u32)
//! 6. meta_len 字节 AES-128-ECB 加密的 JSON metadata（可跳过）
//! 7. 4 字节 CRC32
//! 8. 5 字节 gap
//! 9. 剩余：RC4 变种加密的音频数据
//!
//! RC4 变种（与标准 RC4 不同）：
//! - S-box 初始化后，预生成 256 字节流密码 keystream
//! - 解密：`output[i] = input[i] ^ keystream[i & 0xFF]`
//! - 比标准 RC4 流式生成快，但牺牲了周期 > 256 的扩散性

use aes::Aes128;
use ecb::cipher::block_padding::NoPadding;
// KeyInit 提供 new_from_slice，BlockDecryptMut 提供 decrypt_padded_mut
use ecb::cipher::{BlockDecryptMut as _, KeyInit as _};

use anyhow::{bail, Context, Result};

/// NCM 文件头魔数
const NCM_MAGIC: &[u8] = b"CTENFDAM";

/// AES-128-ECB 固定密钥（网易云客户端硬编码常量）
const NCM_AES_KEY: [u8; 16] = [
    0x68, 0x7A, 0x48, 0x52, 0x41, 0x6D, 0x73, 0x6F, 0x35, 0x6B, 0x49, 0x6E, 0x62, 0x61, 0x78,
    0x2F,
];

/// 解出 RC4 密钥：XOR 0x64 → AES-128-ECB 解密 → 跳过首字节 0x37 前缀
fn build_rc4_key(encrypted: &[u8]) -> Result<Vec<u8>> {
    if encrypted.is_empty() || encrypted.len() % 16 != 0 {
        bail!("NCM key 长度异常: {}", encrypted.len());
    }
    // Step 1: 整段异或 0x64
    let mut xored: Vec<u8> = encrypted.iter().map(|b| b ^ 0x64).collect();
    // Step 2: AES-128-ECB 解密（NoPadding：输出与输入等长，原地解密）
    type Aes128EcbDec = ecb::Decryptor<Aes128>;
    let decryptor = Aes128EcbDec::new_from_slice(&NCM_AES_KEY)
        .context("构造 NCM AES 解密器失败")?;
    let decrypted = decryptor
        .decrypt_padded_mut::<NoPadding>(&mut xored)
        .map_err(|e| anyhow::anyhow!("NCM AES 解密失败: {e}"))?
        .to_vec();
    // Step 3: 跳过首字节 0x37 前缀（客户端写文件时附加的标记）
    if decrypted.is_empty() {
        bail!("NCM key 解密后为空");
    }
    Ok(decrypted[1..].to_vec())
}

/// 构建 NCM 变种 RC4 的 256 字节 keystream
fn build_keystream(key: &[u8]) -> [u8; 256] {
    let mut s: [u8; 256] = [0; 256];
    for i in 0..256 {
        s[i] = i as u8;
    }
    let key_len = key.len();
    let mut j: u8 = 0;
    for i in 0..256 {
        j = j.wrapping_add(s[i]).wrapping_add(key[i % key_len]);
        s.swap(i, j as usize);
    }
    // 预生成 256 字节 keystream（标准 RC4 是流式生成，NCM 是预生成）
    let mut keystream = [0u8; 256];
    let mut si: u8 = 0;
    let mut sj: u8 = 0;
    for k in 0..256 {
        si = si.wrapping_add(1);
        sj = sj.wrapping_add(s[si as usize]);
        s.swap(si as usize, sj as usize);
        keystream[k] = s[(s[si as usize].wrapping_add(s[sj as usize])) as usize];
    }
    keystream
}

/// 解密 NCM 字节流
pub fn decrypt(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() < 16 {
        bail!("NCM 文件过短");
    }
    if &bytes[..8] != NCM_MAGIC {
        bail!("NCM magic 不匹配");
    }
    let mut pos = 10; // 8 magic + 2 gap
    // 读 key 长度
    if bytes.len() < pos + 4 {
        bail!("NCM key 长度字段缺失");
    }
    let key_len = u32::from_le_bytes(bytes[pos..pos + 4].try_into().unwrap()) as usize;
    pos += 4;
    if bytes.len() < pos + key_len {
        bail!("NCM key 段不完整");
    }
    let encrypted_key = &bytes[pos..pos + key_len];
    pos += key_len;
    let rc4_key = build_rc4_key(encrypted_key)?;
    let keystream = build_keystream(&rc4_key);
    // 读 metadata 长度（跳过 metadata 解析，不影响音频）
    if bytes.len() < pos + 4 {
        bail!("NCM meta 长度字段缺失");
    }
    let meta_len = u32::from_le_bytes(bytes[pos..pos + 4].try_into().unwrap()) as usize;
    pos += 4;
    if bytes.len() < pos + meta_len {
        bail!("NCM meta 段不完整");
    }
    pos += meta_len;
    // 4 字节 CRC32 + 5 字节 gap
    if bytes.len() < pos + 9 {
        bail!("NCM CRC/gap 段不完整");
    }
    pos += 9;
    // 剩余：音频数据，用 keystream 循环异或
    let audio = &bytes[pos..];
    let mut output = vec![0u8; audio.len()];
    for (i, b) in audio.iter().enumerate() {
        output[i] = b ^ keystream[i & 0xFF];
    }
    Ok(output)
}
