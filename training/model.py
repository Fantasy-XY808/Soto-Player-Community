"""Soto Player 神经网络上采样模型 - 1D U-Net 架构

输入：[B, 2, T]（立体声波形）
输出：[B, 2, T]（同长度，原地增强）

设计目标：
- 参数量 < 5M（保证实时性，单次推理 < 50ms @ 44.1kHz / 1s 音频）
- 可导出为 ONNX（动态 batch + 动态 samples 维度）
- 与 Rust 侧 model_loader.rs IO 契约严格对齐

架构概览：
- 编码器：4 层 Conv1d(stride=2)，通道 32 / 64 / 128 / 256
- 瓶颈层：Conv1d(stride=1)，通道扩展到 512
- 解码器：4 层 ConvTranspose1d(stride=2)，与编码器对称
- 跳跃连接：编码器各层输出拼接到对应解码器层
- 输出端：1x1 卷积 + sigmoid 映射到 [-1, 1]（防削波）

每层结构：Conv1d → GroupNorm → LeakyReLU(0.01)
"""
from __future__ import annotations

import torch
import torch.nn as nn


def _safe_num_groups(channels: int, max_groups: int = 8) -> int:
    """计算安全的 GroupNorm 分组数：取通道数与 max_groups 的较小值，并保证整除"""
    g = min(max_groups, channels)
    while g > 1 and channels % g != 0:
        g -= 1
    return max(1, g)


class EncoderBlock(nn.Module):
    """编码器块：Conv1d(stride=2) → GroupNorm → LeakyReLU(0.01)

    kernel_size=5, stride=2, padding=2 → 输出长度 ceil(T/2)
    """

    def __init__(self, in_channels: int, out_channels: int, kernel_size: int = 5):
        super().__init__()
        self.conv = nn.Conv1d(
            in_channels, out_channels,
            kernel_size=kernel_size, stride=2, padding=kernel_size // 2,
        )
        self.norm = nn.GroupNorm(_safe_num_groups(out_channels), out_channels)
        self.act = nn.LeakyReLU(0.01, inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(self.norm(self.conv(x)))


class DecoderBlock(nn.Module):
    """解码器块：ConvTranspose1d(stride=2) → concat 跳跃连接 → Conv1d → GroupNorm → LeakyReLU

    反卷积上采样 2x：kernel=4, stride=2, padding=1 → 输出长度 T*2
    """

    def __init__(self, in_channels: int, skip_channels: int, out_channels: int, kernel_size: int = 5):
        super().__init__()
        # 反卷积上采样（通道数先降到 out_channels）
        self.upconv = nn.ConvTranspose1d(
            in_channels, out_channels,
            kernel_size=4, stride=2, padding=1,
        )
        # 拼接跳跃连接后通道数 = out_channels + skip_channels
        self.conv = nn.Conv1d(
            out_channels + skip_channels, out_channels,
            kernel_size=kernel_size, padding=kernel_size // 2,
        )
        self.norm = nn.GroupNorm(_safe_num_groups(out_channels), out_channels)
        self.act = nn.LeakyReLU(0.01, inplace=True)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = self.upconv(x)
        # 长度对齐（防 T 为奇数时尺寸不匹配）
        if x.size(-1) != skip.size(-1):
            min_len = min(x.size(-1), skip.size(-1))
            x = x[..., :min_len]
            skip = skip[..., :min_len]
        x = torch.cat([x, skip], dim=1)
        return self.act(self.norm(self.conv(x)))


class SuperResolutionUNet(nn.Module):
    """1D U-Net 音频超分辨率模型

    架构：4 层编码器（32/64/128/256，stride 2）+ 瓶颈层（512）+ 4 层解码器 + 1x1 输出卷积

    输入：[B, 2, T]
    输出：[B, 2, T]（同长度，原地增强，sigmoid 限制到 [-1, 1]）
    """

    def __init__(self, in_channels: int = 2, base_channels: int = 32, depth: int = 4):
        super().__init__()
        self.in_channels = in_channels
        self.depth = depth

        # 编码器：4 层，通道 32/64/128/256
        self.encoders = nn.ModuleList()
        ch_in = in_channels
        skip_channels_list = []
        for i in range(depth):
            ch_out = base_channels * (2 ** i)
            self.encoders.append(EncoderBlock(ch_in, ch_out))
            skip_channels_list.append(ch_out)
            ch_in = ch_out

        # 瓶颈层（不降采样，通道翻倍到 512）
        ch_bottleneck = ch_in * 2
        self.bottleneck = nn.Sequential(
            nn.Conv1d(ch_in, ch_bottleneck, kernel_size=5, stride=1, padding=2),
            nn.GroupNorm(_safe_num_groups(ch_bottleneck), ch_bottleneck),
            nn.LeakyReLU(0.01, inplace=True),
        )

        # 解码器：4 层，与编码器对称
        self.decoders = nn.ModuleList()
        ch_dec = ch_bottleneck
        for i in range(depth - 1, -1, -1):
            ch_skip = skip_channels_list[i]
            self.decoders.append(DecoderBlock(ch_dec, ch_skip, ch_skip))
            ch_dec = ch_skip

        # 输出 1x1 卷积 + sigmoid 映射到 [-1, 1]（防止削波）
        self.out_conv = nn.Conv1d(ch_dec, in_channels, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # 缓存编码器输出用于跳跃连接
        skips = []
        for encoder in self.encoders:
            x = encoder(x)
            skips.append(x)

        # 瓶颈
        x = self.bottleneck(x)

        # 解码器（反序使用跳跃连接）
        for i, decoder in enumerate(self.decoders):
            skip = skips[-(i + 1)]
            x = decoder(x, skip)

        # 输出卷积 + sigmoid 映射到 [-1, 1]
        x = self.out_conv(x)
        x = torch.sigmoid(x) * 2.0 - 1.0
        return x


def count_parameters(model: nn.Module) -> int:
    """统计模型可训练参数数"""
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


if __name__ == "__main__":
    # 自检：模型参数量 + IO shape + ONNX 导出兼容性
    model = SuperResolutionUNet(in_channels=2, base_channels=32, depth=4)
    n_params = count_parameters(model)
    print(f"参数量: {n_params:,} ({n_params / 1e6:.2f}M)")
    assert n_params < 5_000_000, f"参数量 {n_params} 超过 5M 限制"

    # 测试 forward
    x = torch.randn(1, 2, 44100)
    y = model(x)
    print(f"输入 shape: {x.shape}")
    print(f"输出 shape: {y.shape}")
    assert y.shape == x.shape, f"输出 shape {y.shape} 与输入 {x.shape} 不一致"
    assert y.min() >= -1.0 - 1e-5 and y.max() <= 1.0 + 1e-5, "输出未限制在 [-1, 1]"
    print("✓ 自检通过")
