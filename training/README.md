# Soto Player 神经网络上采样模块 - Phase B 训练脚本

为 Soto Player 音频引擎的神经网络上采样模块提供完整训练、导出、部署流程。

## 目录结构

```
training/
├── requirements.txt        # Python 依赖固定版本
├── model.py                # 1D U-Net 模型架构（< 5M 参数量）
├── dataset.py              # 数据集 + 5 种数据增强 + FMA-small 下载
├── train.py                # 训练主脚本（PyTorch Lightning + 多分辨率 STFT 损失）
├── export_onnx.py          # ONNX 导出与验证脚本
├── download_eben.py        # EBEN 基线下载（仅验证链路，不推荐播放用）
├── README.md               # 本文档
├── data/                   # 数据集目录（用户自备或 FMA-small 下载）
├── checkpoints/            # 训练 checkpoint（自动生成）
├── logs/                   # TensorBoard 日志（自动生成）
└── output/                 # ONNX 输出（自动生成）
```

## 环境准备

- Python 3.10+
- pip install -r requirements.txt

```bash
cd training
pip install -r requirements.txt
```

### 系统依赖（可选）

数据增强中的 MP3 重编码需要 LAME 编码器：

- **Windows**: 下载 [LAME](https://lame.sourceforge.io/) 并将 `lame.exe` 加入 PATH
- **macOS**: `brew install lame`
- **Ubuntu/Debian**: `sudo apt install lame`

或安装 `pydub`（已在 requirements 中作为可选依赖）：

```bash
pip install pydub
```

## 数据集准备

### 选项 1：FMA-small（CC BY 可商用，推荐）

FMA-small 包含 8000 首 30 秒片段，约 8GB，CC BY 许可可商用：

```bash
python dataset.py --download --output-dir training/data/fma_small
```

下载完成后，`training/data/fma_small/` 下应包含 `000/000002.mp3` 等结构。

### 选项 2：自备 WAV/FLAC

将自己拥有的 WAV/FLAC 音乐文件放入 `training/data/`：

```
training/data/
├── song1.wav
├── song2.flac
└── ...
```

支持的格式：`.wav`、`.flac`（其他格式需自行转换）。

> **注意**：MUSDB18-HQ 仅学术用途，不可商用。如需发布带模型的版本，请使用 FMA-small 或自备 CC BY 数据。

## 训练

```bash
python train.py --data-dir training/data/ --epochs 100
```

### 完整参数

```
--data-dir           训练数据目录（必需）
--val-dir            验证数据目录（默认从训练集随机切 10%）
--epochs             训练轮数（默认 100）
--batch-size         批大小（默认 8）
--lr                 学习率（默认 3e-4）
--resume             恢复训练的 checkpoint 路径
--output-dir         输出根目录（默认 training）
--batches-per-epoch  每 epoch 训练 batch 数（默认 1000）
--num-workers        DataLoader 工作进程数（默认 4）
--patience           早期停止耐心值（默认 10）
```

### Resume 训练

```bash
python train.py --data-dir training/data/ --epochs 100 --resume training/checkpoints/last.ckpt
```

### 监控训练

```bash
tensorboard --logdir training/logs/
```

浏览器访问 `http://localhost:6006` 查看 train_loss / val_loss / lr 曲线。

### 训练特性

- **多分辨率 STFT 损失**：FFT 512 / 1024 / 2048（hop 128 / 256 / 512），频谱 L1 + 对数频谱 L1
- **高频加权损失**：> 4kHz 频段损失 × 2
- **优化器**：AdamW，lr=3e-4，weight_decay=1e-5
- **学习率调度**：Cosine Annealing，T_max=100
- **梯度裁剪**：max_norm=1.0
- **早期停止**：val_loss 10 epoch 无改善则停
- **Checkpoint**：自动保存 `best.ckpt`（按 val_loss 最优）和 `last.ckpt`（每 epoch）

## 导出 ONNX

```bash
python export_onnx.py --checkpoint training/checkpoints/best.ckpt --output training/output/super_res.onnx
```

导出脚本会自动：

1. 加载 PyTorch checkpoint
2. 用 `torch.onnx.export` 导出为 ONNX（opset 14，动态 batch + samples）
3. 用 onnxruntime 验证：IO 名、shape、dtype、输出范围、推理耗时

## 部署到 Soto Player

将 `super_res.onnx` 复制到 Soto Player 用户数据目录：

```
{userData}/app-data/models/super_res.onnx
```

各操作系统路径：

- **Windows**: `%APPDATA%\Soto Player\app-data\models\super_res.onnx`
- **macOS**: `~/Library/Application Support/Soto Player/app-data/models/super_res.onnx`
- **Linux**: `~/.config/Soto Player/app-data/models/super_res.onnx`

## 模型 IO 契约（与 Rust `model_loader.rs` 严格对齐）

### 输入

| 项目 | 值 |
|------|-----|
| 名称（按优先级探测） | `input` / `audio` / `waveform` / `x` |
| Shape | `[batch=1, channels=2, samples]` |
| Dtype | `f32` |
| 动态维度 | `{0: 'batch', 2: 'samples'}` |
| 数据范围 | `[-1.0, 1.0]`（标准化浮点） |

### 输出

| 项目 | 值 |
|------|-----|
| 名称（按优先级探测） | `output` / `audio_out` / `waveform_out` / `y` |
| Shape | `[batch=1, channels=2, samples]`（与输入一致，原地增强） |
| Dtype | `f32` |
| 数据范围 | `[-1.0, 1.0]`（sigmoid 限制，防削波） |

### 立体声推理

模型一次性接收立体声（channels=2），Rust 侧 `infer_stereo()` 直接推理整个 `[1, 2, N]` 张量。

### 真上采样模型（可选）

如导出真 2x 上采样模型（输出 samples 是输入 2 倍），Rust 侧 `model_loader.rs` 会自动截取前 N 个样本以保持原地修改契约。

## 数据增强策略

`dataset.py` 实现的 5 种数据增强（每帧随机组合，概率 0.5 各自）：

| # | 增强方式 | 模拟场景 | 实现细节 |
|---|---------|---------|---------|
| 1 | 随机低通滤波 2-8kHz | Tidal AAC 320kbps 缺高频 | `scipy.signal.butter` + `filtfilt`（5 阶，按声道分别滤波） |
| 2 | 随机 MP3 重编码 64-128kbps | 流媒体低品质档 | `pydub` 优先，不可用时退回 `lame` 命令行 |
| 3 | 随机量化降深到 8-12bit | 低位深档 | 等阶量化 `round(x * (L/2 - 1)) / (L/2 - 1)` |
| 4 | 随机下采样到 22.05kHz 再回 44.1kHz | 有损上采样 | `torchaudio.functional.resample` |
| 5 | 随机相位偏移（5-50 样本） | 立体声展宽失真 | 左/右声道其中之一前移 |

### 高频段监督

数据集额外返回高频掩码 `hf_mask`（> 4kHz 频段为 1，否则 0），用于训练时的加权 STFT 损失，确保模型学到高频细节。

## EBEN 基线说明

`download_eben.py` 用于下载 EBEN 基线权重并尝试转 ONNX：

```bash
python download_eben.py --output training/output/eben_generator.ckpt
```

⚠️ **重要警告**：EBEN 默认权重**不推荐用于音乐播放**：

- **训练数据**：French LibriSpeech **语音**（非音乐）
- **输入采样率**：16kHz（Soto Player 需 44.1kHz）
- **声道数**：单声道（Soto Player 需立体声）
- **上采样**：无 2x 上采样（仅带宽扩展，不延长 samples）
- **用途**：仅用于验证 ONNX 加载链路（Rust 侧 `ort::Session::run` 调用通路）

要真正用于音乐 BWE 必须自训（参考 `train.py` + `dataset.py`）。

EBEN 论文：https://arxiv.org/abs/2104.01270
EBEN 仓库：https://github.com/jhauret/eben

## 完整工作流示例

```bash
# 1. 安装依赖
cd training
pip install -r requirements.txt

# 2. 下载 FMA-small 数据集（约 8GB，CC BY 可商用）
python dataset.py --download --output-dir training/data/fma_small

# 3. 训练（约 100 epochs，单卡 GPU 约 12-24 小时）
python train.py --data-dir training/data/fma_small/ --epochs 100

# 4. 导出 ONNX
python export_onnx.py --checkpoint training/checkpoints/best.ckpt --output training/output/super_res.onnx

# 5. 部署
# 将 training/output/super_res.onnx 复制到 {userData}/app-data/models/super_res.onnx
```

## 许可证

### FMA-small

- 许可：CC BY 4.0（部分曲目 CC BY-NC）
- 可商用：CC BY 部分可商用，CC BY-NC 部分仅非商用
- 完整版权信息：https://github.com/mdeff/fma

### MUSDB18-HQ

- 许可：学术研究专用（非商用）
- 仅用于研究 / 教学，不可用于发布带模型的版本
- 完整许可：https://zenodo.org/record/3338373

### EBEN

- 许可：MIT（权重由原作者 jhauret 发布）
- 仅作 ONNX 加载链路验证用途

### 自训模型

- 用户自训模型版权归用户所有
- 数据集许可决定模型许可（CC BY 数据 → CC BY 模型）

## 故障排查

### Q: 训练时报 CUDA OOM？

A: 降低 `--batch-size`（默认 8），或减少 `chunk_size`（在 `dataset.py` 中修改 `DEFAULT_CHUNK_SIZE`）。

### Q: ONNX 导出失败？

A: 检查 PyTorch 版本（需 2.2.0）和 ONNX 版本（需 1.15.0）。

### Q: Soto Player 加载 ONNX 报错？

A: 检查 IO 名是否为 `input` / `output`，shape 是否为 `[1, 2, N]`，dtype 是否为 f32。详见 `model_loader.rs` 推理契约。

### Q: 推理耗时超过 50ms？

A: 模型可能过大（> 5M 参数），或硬件不支持 AVX2/AVX-512。检查 `export_onnx.py` 输出的推理耗时报告。

### Q: EBEN ONNX 加载失败？

A: EBEN 架构与原仓库强耦合，简化架构无法直接加载权重。这不阻塞 Phase B 自训流程，可忽略该错误，使用 `train.py` 自训模型。
