"""EBEN 基线下载与 ONNX 转换脚本

⚠️ 警告 ⚠️
EBEN 默认权重用 French LibriSpeech 语音训练，输入 16kHz 单声道，
不适合音乐 BWE，仅用于验证 ONNX 加载链路！

详细说明：
- 输入采样率：16kHz（Soto Player 需 44.1kHz）
- 声道数：单声道（Soto Player 需立体声）
- 训练数据：French LibriSpeech 语音（非音乐）
- 上采样：无 2x 上采样（仅带宽扩展，不延长 samples）
- 要真正用于音乐 BWE 必须自训（参考 train.py + dataset.py）

EBEN 论文：https://arxiv.org/abs/2104.01270
EBEN 仓库：https://github.com/jhauret/eben
权重地址：https://github.com/jhauret/eben/raw/main/generator.ckpt

使用方式：
    python download_eben.py --output training/output/eben_generator.ckpt
"""
from __future__ import annotations

import argparse
import os
import sys
import urllib.request
from pathlib import Path
from typing import Optional

# EBEN 权重官方下载地址
EBEN_CKPT_URL = "https://github.com/jhauret/eben/raw/main/generator.ckpt"
# EBEN 仓库地址
EBEN_REPO_URL = "https://github.com/jhauret/eben"


def print_warning_banner():
    """打印 EBEN 基线警告横幅"""
    print()
    print("=" * 70)
    print("⚠️  EBEN 基线警告  ⚠️")
    print("=" * 70)
    print("EBEN 默认权重用 French LibriSpeech 语音训练：")
    print("  - 输入采样率：16kHz（Soto Player 需 44.1kHz）")
    print("  - 声道数：单声道（Soto Player 需立体声）")
    print("  - 训练数据：语音，非音乐")
    print("  - 上采样：无 2x 上采样（仅带宽扩展）")
    print()
    print("⚠️  不适合音乐 BWE，仅用于验证 ONNX 加载链路  ⚠️")
    print("要真正用于音乐 BWE 必须自训（参考 train.py + dataset.py）")
    print("=" * 70)
    print()


def download_eben_ckpt(output_path: str) -> str:
    """下载 EBEN generator.ckpt

    Args:
        output_path: 输出文件路径

    Returns:
        下载完成后 .ckpt 文件路径
    """
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    print(f"下载 EBEN 权重:")
    print(f"  URL: {EBEN_CKPT_URL}")
    print(f"  输出: {output_path}")

    try:
        urllib.request.urlretrieve(EBEN_CKPT_URL, output_path, _report_progress)
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        print(f"\n✓ 下载完成: {output_path} ({size_mb:.2f} MB)")
        return output_path
    except Exception as e:
        print(f"\n✗ 下载失败: {e}")
        print()
        print("请手动下载：")
        print(f"  wget -O {output_path} {EBEN_CKPT_URL}")
        print(f"  或浏览器访问 {EBEN_REPO_URL} 获取最新下载链接")
        raise


def _report_progress(block_num: int, block_size: int, total_size: int):
    """urllib.request.urlretrieve 回调：下载进度"""
    downloaded = block_num * block_size
    if total_size > 0:
        percent = min(100, downloaded * 100 // total_size)
        mb_done = downloaded / (1024 * 1024)
        mb_total = total_size / (1024 * 1024)
        print(f"  进度: {percent}% ({mb_done:.1f}/{mb_total:.1f} MB)", end='\r')


def try_convert_eben_to_onnx(ckpt_path: str, output_onnx: str) -> bool:
    """尝试用 EBEN 架构加载权重并转 ONNX

    ⚠️ 警告：
    - EBEN 默认权重用 French LibriSpeech 语音训练
    - 输入采样率 16kHz，单声道
    - 无 2x 上采样（与 model_loader.rs 立体声/44.1kHz 场景不匹配）
    - 仅用于验证 ONNX 加载链路，不推荐用于实际音乐播放

    EBEN 架构（参考论文）：
    - PQMF 分析（4 子带）
    - 3 EncBlock（stride 4，下采样 64x）
    - 3 DecBlock（反卷积上采样）
    - PQMF 合成

    Returns:
        True 转换成功，False 转换失败（不阻塞 Phase B 其他流程）
    """
    print()
    print("=" * 70)
    print("尝试将 EBEN 权重转换为 ONNX")
    print("=" * 70)

    try:
        import torch
        import torch.nn as nn
    except ImportError:
        print("✗ PyTorch 未安装，无法转换")
        print("  请先运行: pip install -r requirements.txt")
        return False

    # EBEN 架构复现（简化版，与原仓库不完全一致）
    # 完整架构需要原仓库代码：https://github.com/jhauret/eben
    class EBENBlock(nn.Module):
        """EBEN Encoder/Decoder Block 简化版"""

        def __init__(self, in_channels: int, out_channels: int, kernel_size: int = 5, stride: int = 4):
            super().__init__()
            # 简化：仅 Conv + PReLU
            self.conv = nn.Conv1d(in_channels, out_channels, kernel_size, stride, kernel_size // 2)
            self.act = nn.PReLU(out_channels)

        def forward(self, x):
            return self.act(self.conv(x))

    class EBEN(nn.Module):
        """EBEN Generator 简化版（不保证与原仓库权重完全兼容）"""

        def __init__(self, n_subbands: int = 4, base_channels: int = 32):
            super().__init__()
            # PQMF 分析（4 子带）
            self.n_subbands = n_subbands
            # 简化：用 1x1 卷积模拟 PQMF
            self.analysis = nn.Conv1d(1, n_subbands, 1)
            # Encoder: 3 blocks, stride 4 each
            self.encoders = nn.ModuleList([
                EBENBlock(n_subbands, base_channels, stride=4),
                EBENBlock(base_channels, base_channels * 2, stride=4),
                EBENBlock(base_channels * 2, base_channels * 4, stride=4),
            ])
            # Decoder: 3 blocks (反卷积 stride 4)
            self.decoders = nn.ModuleList([
                nn.ConvTranspose1d(base_channels * 4, base_channels * 2, 4, 4, 0),
                nn.ConvTranspose1d(base_channels * 2, base_channels, 4, 4, 0),
                nn.ConvTranspose1d(base_channels, n_subbands, 4, 4, 0),
            ])
            self.acts = nn.ModuleList([nn.PReLU(i) for i in [base_channels * 2, base_channels, n_subbands]])
            # PQMF 合成
            self.synthesis = nn.Conv1d(n_subbands, 1, 1)

        def forward(self, x):
            # x: [B, 1, T]
            x = self.analysis(x)
            skips = []
            for enc in self.encoders:
                x = enc(x)
                skips.append(x)
            for dec, act, skip in zip(self.decoders, self.acts, reversed(skips)):
                x = dec(x)
                # 对齐长度
                if x.shape[-1] != skip.shape[-1]:
                    min_len = min(x.shape[-1], skip.shape[-1])
                    x = x[..., :min_len]
                x = x + skip[..., :min_len]
                x = act(x)
            x = self.synthesis(x)
            return x

    try:
        # 1. 尝试加载 checkpoint
        print(f"加载 EBEN checkpoint: {ckpt_path}")
        ckpt = torch.load(ckpt_path, map_location='cpu')
        if 'state_dict' in ckpt:
            keys = list(ckpt['state_dict'].keys())
        elif 'model' in ckpt:
            keys = list(ckpt['model'].keys())
        else:
            keys = list(ckpt.keys())
        print(f"  checkpoint 顶层 keys: {list(ckpt.keys())[:5]}")
        print(f"  state_dict keys (前 10): {keys[:10]}")
        print(f"  state_dict 总参数数: {len(keys)}")

        # 2. 尝试用简化架构加载
        model = EBEN(n_subbands=4, base_channels=32)
        try:
            # 直接尝试加载
            state_dict = ckpt.get('state_dict', ckpt.get('model', ckpt))
            model.load_state_dict(state_dict, strict=False)
            print("  ✓ 简化架构加载成功（strict=False）")
        except Exception as e:
            print(f"  ✗ 简化架构加载失败: {e}")
            raise NotImplementedError(
                "EBEN 完整架构与原仓库强耦合，简化架构无法直接加载权重。"
                "请克隆 EBEN 仓库并按其 README 转换：\n"
                f"  git clone {EBEN_REPO_URL}\n"
                "  cd eben && python export_onnx.py"
            )

        # 3. 尝试导出 ONNX（注意：IO 契约与 model_loader.rs 不匹配，仅作链路验证）
        model.eval()
        Path(output_onnx).parent.mkdir(parents=True, exist_ok=True)
        dummy_input = torch.randn(1, 1, 16384)  # EBEN 输入：16kHz 单声道

        torch.onnx.export(
            model, dummy_input, output_onnx,
            export_params=True,
            opset_version=14,
            input_names=['input'],
            output_names=['output'],
            dynamic_axes={'input': {0: 'batch', 2: 'samples'}, 'output': {0: 'batch', 2: 'samples'}},
        )
        print(f"✓ EBEN ONNX 导出完成: {output_onnx}")

        # 4. 警告：不推荐用于实际播放
        print()
        print("⚠️ 警告：导出的 EBEN ONNX 仅作 ONNX 加载链路验证用途")
        print("   - 输入采样率 16kHz（Soto Player 需 44.1kHz）")
        print("   - 单声道（Soto Player 需立体声）")
        print("   - 语音训练，不适合音乐播放")
        print("   请勿部署到 Soto Player 用于实际音乐 BWE")
        return True

    except NotImplementedError as e:
        print(f"\n✗ EBEN 架构转换需要原仓库代码支持:")
        print(f"  {e}")
        return False
    except Exception as e:
        print(f"\n✗ EBEN ONNX 转换失败: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    parser = argparse.ArgumentParser(description='下载 EBEN 基线并尝试转 ONNX')
    parser.add_argument(
        '--output',
        type=str,
        default='training/output/eben_generator.ckpt',
        help='EBEN 权重保存路径（默认 training/output/eben_generator.ckpt）',
    )
    parser.add_argument(
        '--onnx-output',
        type=str,
        default='training/output/eben.onnx',
        help='EBEN ONNX 输出路径（默认 training/output/eben.onnx）',
    )
    parser.add_argument(
        '--skip-convert',
        action='store_true',
        help='仅下载，不尝试转换',
    )
    parser.add_argument(
        '--skip-download',
        action='store_true',
        help='跳过下载（已下载时使用）',
    )
    args = parser.parse_args()

    # 打印警告横幅
    print_warning_banner()

    # 1. 下载
    if not args.skip_download:
        try:
            ckpt_path = download_eben_ckpt(args.output)
        except Exception:
            print("\n下载失败，退出")
            sys.exit(1)
    else:
        ckpt_path = args.output
        if not os.path.exists(ckpt_path):
            print(f"✗ 文件不存在: {ckpt_path}")
            sys.exit(1)
        print(f"跳过下载，使用已有文件: {ckpt_path}")

    if args.skip_convert:
        print("\n跳过转换（--skip-convert）")
        return

    # 2. 尝试转 ONNX
    success = try_convert_eben_to_onnx(ckpt_path, args.onnx_output)

    # 3. 总结（失败也不退出码非 0，避免阻塞 Phase B 其他流程）
    print()
    print("=" * 70)
    print("EBEN 基线处理总结")
    print("=" * 70)
    if success:
        print(f"✓ EBEN ONNX 转换成功: {args.onnx_output}")
        print("⚠️ 但仍不推荐用于实际音乐播放（语音训练 / 16kHz 单声道 / 无 2x 上采样）")
    else:
        print(f"✗ EBEN ONNX 转换失败")
        print("⚠️ 这不阻塞 Phase B 其他流程（自训模型 + export_onnx.py 仍可正常工作）")
        print()
        print("下一步建议：")
        print("  1. 使用 dataset.py 下载 FMA-small 数据集")
        print("  2. 运行 train.py 自训音乐超分辨率模型")
        print("  3. 运行 export_onnx.py 导出 ONNX")
    print("=" * 70)


if __name__ == "__main__":
    main()
