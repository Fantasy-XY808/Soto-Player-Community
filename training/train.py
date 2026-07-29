"""Soto Player 神经网络上采样模型训练主脚本

使用 PyTorch Lightning LightningModule 实现，主要特性：

1. 多分辨率 STFT 损失（参考 aero/slpa-rl）：
   - 3 个不同 FFT size：512 / 1024 / 2048，hop 128 / 256 / 512
   - 频谱 L1 + 对数频谱 L1（保证时频域联合监督）

2. 额外加权高频损失：高频段（>4kHz）的 STFT 损失 × 2，确保学到高频细节

3. 优化器：AdamW，lr=3e-4，weight_decay=1e-5

4. 学习率调度：cosine annealing，T_max=100 epochs

5. batch_size=8，每 epoch 1000 个 batch（RandomSampler with replacement）

6. 验证集每 epoch 评估一次，保存最优模型（best.ckpt）

7. checkpoint 保存到 training/checkpoints/

8. 支持 resume：python train.py --resume checkpoints/last.ckpt

9. 早期停止：验证损失 10 epoch 无改善则停止

10. 训练日志：tensorboard 写入 training/logs/

命令行参数：--data-dir, --epochs, --batch-size, --lr, --resume, --output-dir
"""
from __future__ import annotations

import argparse
import os
import random
from pathlib import Path
from typing import List, Optional, Tuple

import pytorch_lightning as pl
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR
from torch.utils.data import DataLoader, RandomSampler

from dataset import MusicBWDataset, SR, prepare_file_list
from model import SuperResolutionUNet


# ============== 多分辨率 STFT 损失 ==============

class MultiResolutionSTFTLoss(nn.Module):
    """多分辨率 STFT 损失

    3 个不同 FFT size：512 / 1024 / 2048，hop 128 / 256 / 512
    频谱 L1 + 对数频谱 L1（保证时频域联合监督）
    高频段（> 4kHz）的 STFT 损失 × 2（高频加权）
    """

    def __init__(
        self,
        fft_configs: Optional[List[Tuple[int, int]]] = None,
        hf_cutoff: int = 4000,
        hf_weight: float = 2.0,
        sr: int = SR,
    ):
        super().__init__()
        if fft_configs is None:
            fft_configs = [
                (512, 128),
                (1024, 256),
                (2048, 512),
            ]
        self.fft_configs = fft_configs
        self.hf_cutoff = hf_cutoff
        self.hf_weight = hf_weight
        self.sr = sr
        # 缓存 hann 窗（避免每次 forward 重建）
        self._windows = nn.ModuleDict({
            str(n_fft): nn.HannWindow(n_fft)
            for n_fft, _ in fft_configs
        })

    def _stft(self, x: torch.Tensor, n_fft: int, hop_length: int) -> torch.Tensor:
        """计算 STFT，返回幅度谱"""
        window = self._windows[str(n_fft)].to(x.device)
        stft = torch.stft(
            x,
            n_fft=n_fft,
            hop_length=hop_length,
            window=window,
            return_complex=True,
            center=True,
        )
        return stft.abs()  # [B, n_freqs, n_frames]

    def _spectral_loss(self, x_mag: torch.Tensor, y_mag: torch.Tensor, hf_mask: torch.Tensor) -> torch.Tensor:
        """频谱 L1 + 对数频谱 L1，高频段加权

        x_mag / y_mag: [B, n_freqs, n_frames]
        hf_mask: [n_freqs]，> 4kHz 为 hf_weight，否则 1.0
        """
        # 全频段 L1 + log L1
        l1 = F.l1_loss(x_mag, y_mag)
        log_l1 = F.l1_loss(torch.log(x_mag + 1e-7), torch.log(y_mag + 1e-7))

        # 高频加权 L1（点对点加权平均）
        # hf_mask 形状 [n_freqs] → 广播到 [1, n_freqs, 1]
        weight = hf_mask.view(1, -1, 1)
        weighted_diff = (x_mag - y_mag).abs() * weight
        hf_l1 = weighted_diff.mean()
        weighted_log_diff = (torch.log(x_mag + 1e-7) - torch.log(y_mag + 1e-7)).abs() * weight
        hf_log_l1 = weighted_log_diff.mean()

        # 全频段已经包含了高频段（权重 1.0），额外加 (hf_weight - 1.0) 倍的高频段损失
        # 等价于高频段的总权重为 hf_weight
        extra_hf = (hf_l1 + hf_log_l1) * (self.hf_weight - 1.0)

        return l1 + log_l1 + extra_hf

    def forward(self, x: torch.Tensor, y: torch.Tensor, hf_mask: torch.Tensor = None) -> torch.Tensor:
        """计算多分辨率 STFT 损失

        x: [B, C, T] 预测
        y: [B, C, T] 目标
        hf_mask: [n_freqs] 高频掩码（来自 dataset），None 时自动构造
        """
        B, C, T = x.shape
        total_loss = 0.0

        for n_fft, hop in self.fft_configs:
            # 计算高频掩码（若未提供则按 n_fft 构造）
            if hf_mask is None or hf_mask.shape[0] != n_fft // 2 + 1:
                n_freqs = n_fft // 2 + 1
                freqs = torch.linspace(0, self.sr / 2, n_freqs, device=x.device)
                cur_mask = torch.where(freqs > self.hf_cutoff, self.hf_weight, 1.0)
            else:
                cur_mask = hf_mask.to(x.device)

            # 按声道分别计算 STFT，取平均
            ch_loss = 0.0
            for ch in range(C):
                x_stft = self._stft(x[:, ch], n_fft, hop)
                y_stft = self._stft(y[:, ch], n_fft, hop)
                ch_loss = ch_loss + self._spectral_loss(x_stft, y_stft, cur_mask)
            total_loss = total_loss + ch_loss / C

        # 取 3 个 FFT 配置的平均
        return total_loss / len(self.fft_configs)


# ============== Lightning 模块 ==============

class SuperResolutionModule(pl.LightningModule):
    """PyTorch Lightning 训练模块"""

    def __init__(
        self,
        model: Optional[nn.Module] = None,
        lr: float = 3e-4,
        weight_decay: float = 1e-5,
        epochs: int = 100,
        sr: int = SR,
    ):
        super().__init__()
        # 用 save_hyperparameters 忽略 model（不可序列化）
        self.save_hyperparameters(ignore=['model'])
        self.model = model or SuperResolutionUNet()
        self.lr = lr
        self.weight_decay = weight_decay
        self.epochs = epochs
        self.sr = sr
        self.loss_fn = MultiResolutionSTFTLoss(sr=sr)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.model(x)

    def training_step(self, batch, batch_idx):
        low, high, hf_mask = batch
        pred = self.model(low)
        loss = self.loss_fn(pred, high, hf_mask)
        self.log('train_loss', loss, prog_bar=True, on_step=True, on_epoch=True)
        # 同时记录学习率
        current_lr = self.optimizers().param_groups[0]['lr']
        self.log('lr', current_lr, prog_bar=True, on_step=False, on_epoch=True)
        return loss

    def validation_step(self, batch, batch_idx):
        low, high, hf_mask = batch
        pred = self.model(low)
        loss = self.loss_fn(pred, high, hf_mask)
        self.log('val_loss', loss, prog_bar=True, on_step=False, on_epoch=True)
        return loss

    def configure_optimizers(self):
        optimizer = AdamW(
            self.model.parameters(),
            lr=self.lr,
            weight_decay=self.weight_decay,
        )
        scheduler = CosineAnnealingLR(optimizer, T_max=self.epochs)
        return {
            'optimizer': optimizer,
            'lr_scheduler': {
                'scheduler': scheduler,
                'interval': 'epoch',
                'frequency': 1,
            },
        }


# ============== 主函数 ==============

def main():
    parser = argparse.ArgumentParser(description='Soto Player 神经网络上采样模型训练')
    parser.add_argument('--data-dir', type=str, required=True, help='训练数据目录')
    parser.add_argument('--val-dir', type=str, default=None, help='验证数据目录（默认从训练集随机切 10%）')
    parser.add_argument('--epochs', type=int, default=100, help='训练轮数')
    parser.add_argument('--batch-size', type=int, default=8, help='批大小')
    parser.add_argument('--lr', type=float, default=3e-4, help='学习率')
    parser.add_argument('--resume', type=str, default=None, help='恢复训练的 checkpoint 路径')
    parser.add_argument('--output-dir', type=str, default='training', help='输出根目录（checkpoints/logs 子目录在此下）')
    parser.add_argument('--batches-per-epoch', type=int, default=1000, help='每 epoch 训练 batch 数')
    parser.add_argument('--num-workers', type=int, default=4, help='DataLoader 工作进程数')
    parser.add_argument('--patience', type=int, default=10, help='早期停止耐心值（验证损失无改善 epoch 数）')
    args = parser.parse_args()

    # 准备数据
    print(f"扫描训练数据目录: {args.data_dir}")
    file_list = prepare_file_list(args.data_dir)
    if not file_list:
        raise RuntimeError(f"目录 {args.data_dir} 无音频文件（支持 .wav / .flac）")

    # 切分训练/验证
    if args.val_dir:
        train_files = file_list
        val_files = prepare_file_list(args.val_dir)
        if not val_files:
            raise RuntimeError(f"验证目录 {args.val_dir} 无音频文件")
    else:
        random.shuffle(file_list)
        n_val = max(1, len(file_list) // 10)
        val_files = file_list[:n_val]
        train_files = file_list[n_val:]

    print(f"训练文件数: {len(train_files)}")
    print(f"验证文件数: {len(val_files)}")

    train_ds = MusicBWDataset(train_files, augment=True, augment_p=0.5)
    val_ds = MusicBWDataset(val_files, augment=False)

    # 用 RandomSampler(replacement=True) 保证每 epoch 1000 个 batch
    train_sampler = RandomSampler(
        train_ds,
        replacement=True,
        num_samples=args.batch_size * args.batches_per_epoch,
    )
    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        sampler=train_sampler,
        num_workers=args.num_workers,
        pin_memory=True,
        persistent_workers=args.num_workers > 0,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=min(2, args.num_workers),
        pin_memory=True,
        persistent_workers=min(2, args.num_workers) > 0,
    )

    # 模型 + Lightning 模块
    model = SuperResolutionUNet()
    n_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"模型参数量: {n_params:,} ({n_params / 1e6:.2f}M)")
    assert n_params < 5_000_000, f"参数量 {n_params} 超过 5M 限制"

    module = SuperResolutionModule(
        model=model,
        lr=args.lr,
        weight_decay=1e-5,
        epochs=args.epochs,
    )

    # checkpoint / logger 路径
    ckpt_dir = os.path.join(args.output_dir, 'checkpoints')
    log_dir = os.path.join(args.output_dir, 'logs')
    Path(ckpt_dir).mkdir(parents=True, exist_ok=True)
    Path(log_dir).mkdir(parents=True, exist_ok=True)

    # callbacks
    # 1. 最优 checkpoint（按 val_loss 最小）
    best_ckpt_cb = pl.callbacks.ModelCheckpoint(
        dirpath=ckpt_dir,
        filename='best',
        save_top_k=1,
        monitor='val_loss',
        mode='min',
        verbose=True,
    )
    # 2. 最后 checkpoint（每 epoch 保存，便于 resume）
    last_ckpt_cb = pl.callbacks.ModelCheckpoint(
        dirpath=ckpt_dir,
        filename='last',
        save_top_k=1,
        save_last=True,
        verbose=False,
    )
    # 3. 早期停止
    early_stop_cb = pl.callbacks.EarlyStopping(
        monitor='val_loss',
        patience=args.patience,
        mode='min',
        verbose=True,
    )
    # 4. 学习率监控
    lr_monitor_cb = pl.callbacks.LearningRateMonitor(logging_interval='epoch')

    # trainer
    trainer = pl.Trainer(
        max_epochs=args.epochs,
        accelerator='auto',
        devices='auto',
        callbacks=[best_ckpt_cb, last_ckpt_cb, early_stop_cb, lr_monitor_cb],
        logger=pl.loggers.TensorBoardLogger(log_dir, name='super_res'),
        limit_train_batches=args.batches_per_epoch,
        log_every_n_steps=20,
        accumulate_grad_batches=1,
        gradient_clip_val=1.0,  # 梯度裁剪，防爆炸
    )

    # 训练（支持从 ckpt_path resume）
    trainer.fit(module, train_loader, val_loader, ckpt_path=args.resume)

    # 训练结束打印最优 checkpoint 路径
    print()
    print("=" * 60)
    print("训练完成")
    print("=" * 60)
    if best_ckpt_cb.best_model_path:
        print(f"最优 checkpoint: {best_ckpt_cb.best_model_path}")
        print(f"最优 val_loss: {best_ckpt_cb.best_model_score:.6f}")
    print(f"最后 checkpoint: {os.path.join(ckpt_dir, 'last.ckpt')}")
    print(f"导出 ONNX: python export_onnx.py --checkpoint {best_ckpt_cb.best_model_path} --output training/output/super_res.onnx")


if __name__ == "__main__":
    main()
