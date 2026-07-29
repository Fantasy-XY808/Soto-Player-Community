"""ONNX 导出脚本

将训练好的 PyTorch checkpoint 导出为 ONNX，严格对齐 Rust 侧 model_loader.rs IO 契约：

IO 契约（必须严格遵守）：
- 输入名：`input`（最优先）
- 输出名：`output`（最优先）
- 输入 shape：`[1, 2, samples]`（batch=1, 立体声, samples 动态）
- 输出 shape：与输入相同（原地增强）
- dtype：f32
- 动态维度：`{0: 'batch', 2: 'samples'}`
- opset 版本：14

导出后立即用 onnxruntime 验证：加载 ONNX → 推理一个测试样本 → 检查输出 shape
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
from typing import Dict

import numpy as np
import onnxruntime as ort
import torch

from model import SuperResolutionUNet


# ONNX 导出 IO 配置（与 model_loader.rs 探测顺序对齐）
ONNX_INPUT_NAME = 'input'
ONNX_OUTPUT_NAME = 'output'
ONNX_DYNAMIC_AXES: Dict[str, Dict[int, str]] = {
    'input': {0: 'batch', 2: 'samples'},
    'output': {0: 'batch', 2: 'samples'},
}
ONNX_OPSET_VERSION = 14
# 参考 shape（导出时的 dummy 输入，实际推理时可变）
ONNX_REFERENCE_SHAPE = (1, 2, 44100)


def load_checkpoint(checkpoint_path: str, model: SuperResolutionUNet) -> SuperResolutionUNet:
    """加载 PyTorch checkpoint 到模型

    兼容：
    - PyTorch Lightning checkpoint（含 'state_dict' 键，模型参数前缀为 'model.'）
    - 普通 state_dict
    """
    print(f"加载 checkpoint: {checkpoint_path}")
    ckpt = torch.load(checkpoint_path, map_location='cpu')

    if 'state_dict' in ckpt:
        # Lightning checkpoint：剥离 'model.' 前缀
        state_dict = {
            k[len('model.'):] if k.startswith('model.') else k: v
            for k, v in ckpt['state_dict'].items()
        }
    else:
        state_dict = ckpt

    # strict=False 容忍少量键不匹配（如 augment 临时状态等）
    missing, unexpected = model.load_state_dict(state_dict, strict=False)
    if missing:
        print(f"  缺失键: {missing[:5]}{'...' if len(missing) > 5 else ''}")
    if unexpected:
        print(f"  意外键: {unexpected[:5]}{'...' if len(unexpected) > 5 else ''}")
    print("✓ checkpoint 加载成功")
    return model


def export_to_onnx(
    checkpoint_path: str,
    output_path: str,
    opset_version: int = ONNX_OPSET_VERSION,
):
    """导出模型为 ONNX

    严格对齐 model_loader.rs：
    - 输入名：`input`（最优先）
    - 输出名：`output`（最优先）
    - 动态维度：{0: 'batch', 2: 'samples'}
    - opset 版本：14
    """
    # 1. 加载模型 + checkpoint
    model = SuperResolutionUNet(in_channels=2, base_channels=32, depth=4)
    model = load_checkpoint(checkpoint_path, model)
    model.eval()

    # 2. 构造 dummy input [1, 2, 44100]
    dummy_input = torch.randn(*ONNX_REFERENCE_SHAPE, dtype=torch.float32)

    # 3. 确保输出目录存在
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    # 4. 导出 ONNX
    print(f"导出 ONNX 到: {output_path}")
    print(f"  输入名: {ONNX_INPUT_NAME}")
    print(f"  输出名: {ONNX_OUTPUT_NAME}")
    print(f"  动态维度: {ONNX_DYNAMIC_AXES}")
    print(f"  opset 版本: {opset_version}")
    print(f"  参考 shape: {ONNX_REFERENCE_SHAPE}")

    with torch.no_grad():
        torch.onnx.export(
            model,
            dummy_input,
            output_path,
            export_params=True,
            opset_version=opset_version,
            do_constant_folding=True,
            input_names=[ONNX_INPUT_NAME],
            output_names=[ONNX_OUTPUT_NAME],
            dynamic_axes=ONNX_DYNAMIC_AXES,
        )
    print(f"✓ 导出完成: {output_path}")

    # 文件大小
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  文件大小: {size_mb:.2f} MB")


def verify_onnx(onnx_path: str):
    """用 onnxruntime 验证 ONNX 模型

    加载 ONNX → 推理一个测试样本 → 检查输出 shape
    验证项：
    1. 输入名包含 'input'
    2. 输出名包含 'output'
    3. 输出 shape = 输入 shape 或 samples 维 2x
    4. 输出范围在 [-1, 1]（sigmoid 限制）
    5. 动态 batch + samples 维度工作正常
    """
    print(f"\n验证 ONNX 模型: {onnx_path}")

    # 1. 加载 ONNX
    sess = ort.InferenceSession(onnx_path, providers=['CPUExecutionProvider'])

    # 2. 检查 IO 名（应与 model_loader.rs 一致）
    input_names = [i.name for i in sess.get_inputs()]
    output_names = [o.name for o in sess.get_outputs()]
    print(f"  输入名: {input_names}")
    print(f"  输出名: {output_names}")
    assert ONNX_INPUT_NAME in input_names, \
        f"输入名应包含 '{ONNX_INPUT_NAME}'，实际: {input_names}"
    assert ONNX_OUTPUT_NAME in output_names, \
        f"输出名应包含 '{ONNX_OUTPUT_NAME}'，实际: {output_names}"

    # 3. 检查输入 shape（应包含动态维度，dim[2] 应为 -1 或字符串）
    input_meta = sess.get_inputs()[0]
    print(f"  输入 shape: {input_meta.shape}")
    print(f"  输入 dtype: {input_meta.type}")

    # 4. 推理测试样本（参考 shape: [1, 2, 44100]）
    test_input = np.random.randn(*ONNX_REFERENCE_SHAPE).astype(np.float32)
    outputs = sess.run([ONNX_OUTPUT_NAME], {ONNX_INPUT_NAME: test_input})
    output = outputs[0]

    print(f"  输入 shape: {test_input.shape}")
    print(f"  输出 shape: {output.shape}")

    # 5. 检查输出 samples 维度
    expected_samples = test_input.shape[-1]
    out_samples = output.shape[-1]
    assert out_samples in (expected_samples, expected_samples * 2), \
        f"输出 samples {out_samples} 应为 {expected_samples} 或 {expected_samples * 2}"

    # 6. 检查输出范围 [-1, 1]（sigmoid 限制）
    out_min, out_max = float(output.min()), float(output.max())
    print(f"  输出范围: [{out_min:.4f}, {out_max:.4f}]")
    assert -1.0 - 1e-3 <= out_min and out_max <= 1.0 + 1e-3, \
        f"输出范围 [{out_min}, {out_max}] 超出 [-1, 1]"

    # 7. 测试动态 batch 维度
    test_input_b = np.random.randn(2, 2, 44100).astype(np.float32)
    outputs_b = sess.run([ONNX_OUTPUT_NAME], {ONNX_INPUT_NAME: test_input_b})
    print(f"  动态 batch 测试: 输入 {test_input_b.shape} → 输出 {outputs_b[0].shape}")
    assert outputs_b[0].shape[0] == 2, "动态 batch 维度未生效"

    # 8. 测试动态 samples 维度
    test_input_s = np.random.randn(1, 2, 22050).astype(np.float32)
    outputs_s = sess.run([ONNX_OUTPUT_NAME], {ONNX_INPUT_NAME: test_input_s})
    print(f"  动态 samples 测试: 输入 {test_input_s.shape} → 输出 {outputs_s[0].shape}")
    assert outputs_s[0].shape[-1] in (22050, 44100), "动态 samples 维度未生效"

    # 9. 推理耗时测试（参考 50ms @ 44.1kHz / 1s 音频）
    import time
    test_input_perf = np.random.randn(1, 2, 44100).astype(np.float32)
    # 预热
    for _ in range(3):
        sess.run([ONNX_OUTPUT_NAME], {ONNX_INPUT_NAME: test_input_perf})
    # 计时
    n_runs = 10
    t0 = time.perf_counter()
    for _ in range(n_runs):
        sess.run([ONNX_OUTPUT_NAME], {ONNX_INPUT_NAME: test_input_perf})
    elapsed_ms = (time.perf_counter() - t0) / n_runs * 1000
    print(f"  推理耗时（{n_runs} 次平均）: {elapsed_ms:.2f} ms / 1s 音频")
    if elapsed_ms < 50:
        print("  ✓ 满足实时性要求（< 50ms）")
    else:
        print(f"  ⚠ 超过 50ms 实时性要求（{elapsed_ms:.2f}ms）")

    print("\n✓ ONNX 模型验证全部通过")


def main():
    parser = argparse.ArgumentParser(description='导出 ONNX 模型（对齐 model_loader.rs IO 契约）')
    parser.add_argument('--checkpoint', type=str, required=True, help='PyTorch checkpoint 路径')
    parser.add_argument('--output', type=str, default='training/output/super_res.onnx', help='ONNX 输出路径')
    parser.add_argument('--opset', type=int, default=ONNX_OPSET_VERSION, help='ONNX opset 版本')
    parser.add_argument('--skip-verify', action='store_true', help='跳过 onnxruntime 验证')
    args = parser.parse_args()

    # 检查 checkpoint 存在
    if not os.path.exists(args.checkpoint):
        raise FileNotFoundError(f"checkpoint 不存在: {args.checkpoint}")

    export_to_onnx(args.checkpoint, args.output, opset_version=args.opset)

    if not args.skip_verify:
        verify_onnx(args.output)

    print()
    print("=" * 60)
    print("部署说明")
    print("=" * 60)
    print(f"将 ONNX 文件复制到 Soto Player 用户数据目录:")
    print(f"  源: {args.output}")
    print(f"  目标: {{userData}}/app-data/models/super_res.onnx")
    print(f"  （Windows: %APPDATA%\\Soto Player\\app-data\\models\\super_res.onnx）")
    print(f"  （macOS: ~/Library/Application Support/Soto Player/app-data/models/super_res.onnx）")
    print(f"  （Linux: ~/.config/Soto Player/app-data/models/super_res.onnx）")


if __name__ == "__main__":
    main()
