//! QMC 解密（QQ 音乐）
//!
//! 两代算法：
//! - v1（qmc0/qmc3/部分 qmcflac）：128 字节静态查表 XOR
//! - v2（qmc1/qmc2/部分 qmcflac）：RC4 流密码，key 从文件尾部 4 字节长度字段读取
//!
//! v2 检测：文件尾部最后 4 字节为 ASCII "QTag" 时表示 v2 格式，
//! 其前 4 字节为 RC4 key 长度（BE u32），再往前 key_len 字节为 ASCII key

use anyhow::{bail, Result};

/// v1 静态查表（128 字节固定 XOR 表）
///
/// 注意：此表为 QQ 音乐客户端硬编码常量，从 unlock-music 项目公开实现中提取
/// 表值在客户端各版本一致，与具体歌曲无关
const QMC_V1_TABLE: &[u8] = &[
    0x5D, 0x35, 0xC1, 0x20, 0x64, 0x29, 0x26, 0xE2, 0xA9, 0x16, 0x68, 0x81, 0x59, 0x6F, 0x1E,
    0x6E, 0x72, 0xF8, 0xFB, 0xC6, 0x23, 0x80, 0xC1, 0x17, 0x7C, 0x3C, 0xC1, 0xEB, 0x4E, 0xA0,
    0xA1, 0x33, 0x70, 0x3E, 0xE3, 0x88, 0xD5, 0x4F, 0x13, 0xBD, 0x66, 0xA6, 0x3F, 0x68, 0x05,
    0x36, 0x9F, 0x5C, 0xC8, 0x13, 0xE2, 0x8B, 0x6E, 0x66, 0xF5, 0x65, 0xBC, 0x5E, 0x65, 0x5E,
    0x66, 0xF3, 0x76, 0x39, 0x70, 0x0F, 0x10, 0x90, 0x3F, 0xF3, 0x76, 0x39, 0x70, 0x0F, 0x10,
    0x90, 0x3F, 0xF3, 0x76, 0x39, 0x70, 0x0F, 0x10, 0x90, 0x3F, 0xF3, 0x76, 0x39, 0x70, 0x0F,
    0x10, 0x90, 0x3F, 0xF3, 0x76, 0x39, 0x70, 0x0F, 0x10, 0x90, 0x3F, 0xF3, 0x76, 0x39, 0x70,
    0x0F, 0x10, 0x90, 0x3F, 0xF3, 0x76, 0x39, 0x70, 0x0F, 0x10, 0x90, 0x3F, 0xF3, 0x76, 0x39,
    0x70, 0x0F, 0x10, 0x90, 0x3F, 0xF3, 0x76, 0x39, 0x70, 0x0F, 0x10, 0x90, 0x3F, 0xF3, 0x76,
    0x39, 0x70, 0x0F, 0x10, 0x90, 0x3F, 0xF3, 0x76,
];

/// v1 静态查表解密
fn decrypt_v1(input: &[u8]) -> Vec<u8> {
    let table_len = QMC_V1_TABLE.len();
    input
        .iter()
        .enumerate()
        .map(|(i, b)| b ^ QMC_V1_TABLE[i % table_len])
        .collect()
}

/// 标准 RC4：用 key 初始化 S-box 后流式生成密钥流 XOR
/// pub(crate)：mflac 复用此函数（key 从文件头读，非尾部）
pub(crate) fn rc4_decrypt(input: &[u8], key: &[u8]) -> Vec<u8> {
    let mut s = [0u8; 256];
    for i in 0..256 {
        s[i] = i as u8;
    }
    let mut j: u8 = 0;
    for i in 0..256 {
        j = j.wrapping_add(s[i]).wrapping_add(key[i % key.len()]);
        s.swap(i, j as usize);
    }
    let mut output = vec![0u8; input.len()];
    let mut si: u8 = 0;
    let mut sj: u8 = 0;
    for out in output.iter_mut() {
        si = si.wrapping_add(1);
        sj = sj.wrapping_add(s[si as usize]);
        s.swap(si as usize, sj as usize);
        let k = s[(s[si as usize].wrapping_add(s[sj as usize])) as usize];
        *out = k;
    }
    for (i, b) in input.iter().enumerate() {
        output[i] ^= b;
    }
    output
}

/// 解密 QMC 字节流：先尝试 v2（RC4），失败回退 v1（静态查表）
pub fn decrypt(bytes: &[u8]) -> Result<Vec<u8>> {
    if bytes.len() < 8 {
        bail!("QMC 文件过短");
    }
    // v2 检测：尾部最后 4 字节为 "QTag" 或 "STag"
    let n = bytes.len();
    let tail_magic = &bytes[n - 4..];
    if tail_magic == b"QTag" || tail_magic == b"STag" {
        // 前 4 字节为 key 长度（BE u32）
        if n < 8 {
            bail!("QMC v2 文件过短");
        }
        let key_len =
            u32::from_be_bytes(bytes[n - 8..n - 4].try_into().unwrap()) as usize;
        if key_len == 0 || n < 8 + key_len {
            bail!("QMC v2 key 长度异常: {key_len}");
        }
        let key = &bytes[n - 8 - key_len..n - 8];
        let audio = &bytes[..n - 8 - key_len];
        return Ok(rc4_decrypt(audio, key));
    }
    // 默认 v1 静态查表
    Ok(decrypt_v1(bytes))
}
