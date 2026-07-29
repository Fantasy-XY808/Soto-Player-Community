"""Soto Player 训练数据集 - 5 种数据增强模拟 Tidal/Qobuz 低品质档

数据增强策略（每帧随机组合，概率 0.5 各自）：
1. 随机低通滤波 2-8kHz（用 scipy.signal.butter + filtfilt，模拟 Tidal AAC 320kbps 缺高频）
2. 随机 MP3 重编码 64-128kbps（用 pydub 或 subprocess 调 lame，模拟流媒体低品质档）
3. 随机量化降深到 8-12bit（模拟低位深档）
4. 随机下采样到 22.05kHz 然后重采样回 44.1kHz（模拟有损上采样）
5. 随机相位偏移（立体声左右微差，模拟立体声展宽失真）

高频段监督：额外返回 mask（高通 4kHz 之后的频段），用于加权 STFT 损失
"""
from __future__ import annotations

import io
import os
import random
import subprocess
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np
import soundfile as sf
import torch
import torchaudio
from torch.utils.data import Dataset

try:
    from scipy.signal import butter, filtfilt
    _HAS_SCIPY = True
except ImportError:
    _HAS_SCIPY = False

# 默认采样率
SR = 44100
# 默认块长度（3 秒）
DEFAULT_CHUNK_SIZE = SR * 3
# 高频分割点（4kHz，用于高频段监督）
HF_CUTOFF = 4000
# STFT 默认 n_fft（高频掩码基于此计算频段）
DEFAULT_N_FFT = 2048


def prepare_file_list(data_dir: str, extensions: Optional[List[str]] = None) -> List[str]:
    """扫描目录下所有音频文件，返回路径列表"""
    if extensions is None:
        extensions = ['.wav', '.flac']
    ext_set = {e.lower() for e in extensions}
    files = []
    for root, _, names in os.walk(data_dir):
        for name in names:
            if Path(name).suffix.lower() in ext_set:
                files.append(os.path.join(root, name))
    files.sort()
    return files


# ============== 5 种数据增强 ==============

def _butter_lowpass(cutoff: float, sr: int, order: int = 5):
    """构造 Butterworth 低通滤波器系数"""
    nyq = 0.5 * sr
    norm = cutoff / nyq
    b, a = butter(order, norm, btype='low')
    return b, a


def augment_lowpass(audio: np.ndarray, sr: int) -> np.ndarray:
    """1. 低通滤波 2-8kHz（模拟 Tidal AAC 320kbps 缺高频）

    用 scipy.signal.butter + filtfilt 实现，按声道分别滤波
    """
    if not _HAS_SCIPY:
        # scipy 不可用时跳过
        return audio.astype(np.float32)
    cutoff = random.uniform(2000, 8000)
    b, a = _butter_lowpass(cutoff, sr, order=5)
    if audio.ndim == 1:
        return filtfilt(b, a, audio).astype(np.float32)
    out = np.zeros_like(audio, dtype=np.float32)
    for ch in range(audio.shape[0]):
        out[ch] = filtfilt(b, a, audio[ch])
    return out


def augment_mp3(audio: np.ndarray, sr: int) -> np.ndarray:
    """2. MP3 重编码 64-128kbps（模拟流媒体低品质档）

    优先用 pydub（更易用），不可用时退回 lame 命令行
    """
    # 统一为 [C, T] 形式
    if audio.ndim == 1:
        audio_2d = audio[np.newaxis, :]
    else:
        audio_2d = audio
    channels = audio_2d.shape[0]

    # 优先 pydub
    try:
        from pydub import AudioSegment
        bitrate = random.choice(['64k', '96k', '128k'])
        # 转为交错 int16
        interleaved = audio_2d.T.reshape(-1)
        interleaved = np.clip(interleaved, -1.0, 1.0)
        samples_int16 = (interleaved * 32767).astype(np.int16)
        seg = AudioSegment(
            samples_int16.tobytes(),
            frame_rate=sr,
            sample_width=2,
            channels=channels,
        )
        # MP3 编码 → 解码（模拟有损重压缩）
        buf = io.BytesIO()
        seg.export(buf, format='mp3', bitrate=bitrate)
        buf.seek(0)
        decoded = AudioSegment.from_file(buf, format='mp3')
        samples = np.array(decoded.get_array_of_samples()).astype(np.float32) / 32767.0
        # 还原 [C, T]
        if decoded.channels == channels:
            samples = samples.reshape(-1, channels).T
        if audio.ndim == 1:
            samples = samples[0]
        return samples.astype(np.float32)
    except ImportError:
        pass

    # 备选：lame 命令行
    try:
        bitrate = random.choice([64, 96, 128])
        interleaved = audio_2d.T.reshape(-1)
        interleaved = np.clip(interleaved, -1.0, 1.0)
        samples_int16 = (interleaved * 32767).astype(np.int16)
        with tempfile.TemporaryDirectory() as tmp:
            wav_in = os.path.join(tmp, 'in.wav')
            mp3_path = os.path.join(tmp, 'tmp.mp3')
            wav_out = os.path.join(tmp, 'out.wav')
            sf.write(wav_in, samples_int16, sr, subtype='PCM_16')
            subprocess.run(
                ['lame', '-b', str(bitrate), wav_in, mp3_path],
                check=True, capture_output=True,
            )
            subprocess.run(
                ['lame', '--decode', mp3_path, wav_out],
                check=True, capture_output=True,
            )
            data, _ = sf.read(wav_out, dtype='float32', always_2d=True)
            data = data.T  # [C, T]
            if audio.ndim == 1:
                data = data[0]
            return data
    except Exception:
        # 增强失败时跳过
        return audio.astype(np.float32)


def augment_bit_depth(audio: np.ndarray, sr: int) -> np.ndarray:
    """3. 量化降深到 8-12bit（模拟低位深档）

    随机选择 bits，等阶量化到 [-1, 1]
    """
    bits = random.randint(8, 12)
    levels = 2 ** bits
    # 量化：round(x * (L/2 - 1)) / (L/2 - 1)
    half = levels / 2 - 1
    q = np.round(audio * half) / half
    return q.astype(np.float32)


def augment_resample(audio: np.ndarray, sr: int) -> np.ndarray:
    """4. 下采样到 22.05kHz 然后重采样回 44.1kHz（模拟有损上采样）

    用 torchaudio.functional.resample 实现
    """
    target_sr = sr // 2
    tensor = torch.from_numpy(audio).float()
    is_1d = tensor.ndim == 1
    if is_1d:
        tensor = tensor.unsqueeze(0)
    # 降采样 → 升回原采样率
    down = torchaudio.functional.resample(tensor, sr, target_sr)
    up = torchaudio.functional.resample(down, target_sr, sr)
    # 对齐长度
    min_len = min(up.shape[-1], audio.shape[-1])
    up = up[..., :min_len]
    out = up.numpy().astype(np.float32)
    if is_1d:
        out = out[0]
    return out


def augment_phase_shift(audio: np.ndarray, sr: int) -> np.ndarray:
    """5. 立体声左右微差相位偏移（模拟立体声展宽失真）

    随机延迟 5-50 个样本，左/右声道其中之一前移
    """
    if audio.ndim != 2 or audio.shape[0] != 2:
        return audio.astype(np.float32)
    delay = random.randint(5, 50)
    out = audio.copy()
    if random.random() < 0.5:
        # 左声道前移
        out[0, :-delay] = audio[0, delay:]
        out[0, -delay:] = audio[0, -delay:]
    else:
        # 右声道前移
        out[1, :-delay] = audio[1, delay:]
        out[1, -delay:] = audio[1, -delay:]
    return out.astype(np.float32)


def apply_augmentations(audio: np.ndarray, sr: int, p: float = 0.5) -> np.ndarray:
    """以概率 p 应用 5 种增强（每条独立判断）"""
    augmentations = [
        augment_lowpass,
        augment_mp3,
        augment_bit_depth,
        augment_resample,
        augment_phase_shift,
    ]
    out = audio.copy()
    for aug in augmentations:
        if random.random() < p:
            try:
                out = aug(out, sr)
            except Exception:
                # 单条增强失败不影响其他
                pass
    # 保证长度对齐（MP3/重采样可能改变长度）
    if out.shape[-1] != audio.shape[-1]:
        min_len = min(out.shape[-1], audio.shape[-1])
        out = out[..., :min_len]
    return out.astype(np.float32)


# ============== 数据集类 ==============

class MusicBWDataset(Dataset):
    """音乐超分辨率训练数据集

    从高质量 WAV/FLAC 文件读取，应用 5 种数据增强模拟低品质档，
    返回 (low_quality, high_quality, hf_mask) 三元组：
    - low_quality: [2, chunk_size] 低品质输入
    - high_quality: [2, chunk_size] 高品质目标
    - hf_mask: [n_freqs] 高频掩码（> 4kHz 为 1，否则 0），用于加权 STFT 损失
    """

    def __init__(
        self,
        file_list: List[str],
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        sr: int = SR,
        augment: bool = True,
        augment_p: float = 0.5,
        n_fft: int = DEFAULT_N_FFT,
    ):
        self.file_list = list(file_list)
        self.chunk_size = chunk_size
        self.sr = sr
        self.augment = augment
        self.augment_p = augment_p
        self.n_fft = n_fft
        # 预计算高频掩码（与 chunk 无关，固定）
        self._hf_mask = self._compute_hf_mask()

    def __len__(self) -> int:
        return len(self.file_list)

    def _compute_hf_mask(self) -> torch.Tensor:
        """计算高频掩码：> HF_CUTOFF 的频段为 1，其余为 0"""
        n_freqs = self.n_fft // 2 + 1
        freqs = torch.linspace(0, self.sr / 2, n_freqs)
        return (freqs > HF_CUTOFF).float()

    def _load_audio(self, path: str) -> np.ndarray:
        """加载音频文件，转 [2, T] float32"""
        data, sr = sf.read(path, dtype='float32', always_2d=True)
        # data shape: [T, C] → [C, T]
        data = data.T
        # 立体声转换（单声道复制为立体声，多声道取前两路）
        if data.shape[0] == 1:
            data = np.repeat(data, 2, axis=0)
        elif data.shape[0] > 2:
            data = data[:2]
        # 重采样到目标采样率
        if sr != self.sr:
            tensor = torch.from_numpy(data).float()
            tensor = torchaudio.functional.resample(tensor, sr, self.sr)
            data = tensor.numpy().astype(np.float32)
        return data

    def _random_chunk(self, audio: np.ndarray) -> np.ndarray:
        """随机裁剪 chunk_size 长度的片段"""
        T = audio.shape[-1]
        if T < self.chunk_size:
            # 不足则循环填充
            reps = (self.chunk_size + T - 1) // T
            audio = np.tile(audio, (1, reps))
            T = audio.shape[-1]
        start = random.randint(0, T - self.chunk_size)
        return audio[:, start:start + self.chunk_size]

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        path = self.file_list[idx]
        try:
            audio = self._load_audio(path)
        except Exception:
            # 加载失败时返回静音
            audio = np.zeros((2, self.chunk_size), dtype=np.float32)

        chunk = self._random_chunk(audio)
        high_quality = chunk.copy()

        if self.augment:
            low_quality = apply_augmentations(chunk, self.sr, p=self.augment_p)
        else:
            low_quality = chunk.copy()

        # 对齐长度（增强可能改变长度）
        min_len = min(low_quality.shape[-1], high_quality.shape[-1], self.chunk_size)
        low_quality = low_quality[..., :min_len]
        high_quality = high_quality[..., :min_len]

        return (
            torch.from_numpy(low_quality).float(),
            torch.from_numpy(high_quality).float(),
            self._hf_mask,
        )


# ============== FMA-small 数据集下载 ==============

# FMA-small 数据集官方地址
FMA_SMALL_URL = "https://os.unil.cloud.switch.ch/fma/fma_small.zip"
FMA_METADATA_URL = "https://os.unil.cloud.switch.ch/fma/fma_metadata.zip"


def download_fma_dataset(output_dir: str = 'training/data/fma_small') -> str:
    """下载 FMA-small 数据集（CC BY 可商用，避免 MUSDB18-HQ 学术许可限制）

    FMA-small 包含 8000 首 30 秒片段，总大小约 8GB

    本函数会：
    1. 创建输出目录
    2. 下载 fma_small.zip（约 8GB，可能需要数小时）
    3. 解压到 output_dir
    4. 返回解压后目录路径

    若下载失败，提示用户手动下载
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    zip_path = output_path / 'fma_small.zip'

    print("=" * 60)
    print("FMA-small 数据集下载")
    print("=" * 60)
    print(f"  数据集: 8000 首 30s 片段，CC BY 可商用")
    print(f"  总大小: 约 8GB（下载可能需要数小时）")
    print(f"  官方仓库: https://github.com/mdeff/fma")
    print(f"  下载地址: {FMA_SMALL_URL}")
    print(f"  输出目录: {output_path}")
    print("=" * 60)
    print()

    # 检查是否已存在解压后数据
    extracted_dir = output_path / 'fma_small'
    if extracted_dir.exists() and any(extracted_dir.rglob('*.mp3')):
        print(f"✓ 已检测到解压后数据: {extracted_dir}")
        return str(extracted_dir)

    # 下载 zip
    if not zip_path.exists():
        print(f"开始下载 {FMA_SMALL_URL}...")
        try:
            urllib.request.urlretrieve(FMA_SMALL_URL, zip_path, _report_download_progress)
            print(f"\n✓ 下载完成: {zip_path}")
        except Exception as e:
            print(f"\n✗ 下载失败: {e}")
            print()
            print("请手动下载：")
            print(f"  wget -O {zip_path} {FMA_SMALL_URL}")
            print(f"  或浏览器访问 https://github.com/mdeff/fma 获取最新下载链接")
            return str(output_path)
    else:
        print(f"✓ 已存在下载文件: {zip_path}")

    # 解压
    print(f"解压 {zip_path} → {output_path}...")
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(output_path)
        print(f"✓ 解压完成")
    except Exception as e:
        print(f"✗ 解压失败: {e}")
        print(f"  请手动解压: unzip {zip_path} -d {output_path}")
        return str(output_path)

    return str(extracted_dir if extracted_dir.exists() else output_path)


def _report_download_progress(block_num: int, block_size: int, total_size: int):
    """urllib.request.urlretrieve 回调：下载进度"""
    downloaded = block_num * block_size
    if total_size > 0:
        percent = min(100, downloaded * 100 // total_size)
        mb_done = downloaded / (1024 * 1024)
        mb_total = total_size / (1024 * 1024)
        # 每 5% 输出一次
        if percent % 5 == 0:
            print(f"  进度: {percent}% ({mb_done:.1f}/{mb_total:.1f} MB)", end='\r')


def main():
    """命令行入口：python dataset.py --download 或 python dataset.py --scan <dir>"""
    import argparse
    parser = argparse.ArgumentParser(description='Soto Player 数据集工具')
    parser.add_argument('--download', action='store_true', help='下载 FMA-small 数据集')
    parser.add_argument('--output-dir', type=str, default='training/data/fma_small', help='下载输出目录')
    parser.add_argument('--scan', type=str, default=None, help='扫描指定目录下的音频文件')
    args = parser.parse_args()

    if args.download:
        download_fma_dataset(args.output_dir)
    elif args.scan:
        files = prepare_file_list(args.scan)
        print(f"找到 {len(files)} 个音频文件:")
        for f in files[:10]:
            print(f"  {f}")
        if len(files) > 10:
            print(f"  ... 共 {len(files)} 个")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
