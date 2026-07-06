import { loadNativeModule } from "@main/utils/nativeLoader";
import { getCoverCacheDir, isDev } from "@main/utils/config";
import { playerLog, nativeLogsDir } from "@main/utils/logger";
import type {
  BassEnhancerSettings,
  LoudnessNormalizerSettings,
  NeuralUpsampleSettings,
  ProxySettings,
  SpatialAudioSettings,
  StereoWidenerSettings,
  SuperResParams,
} from "@shared/types/settings";

type AudioEngineModule = typeof import("@splayer/audio-engine");
type PlayerInstance = InstanceType<AudioEngineModule["AudioPlayer"]>;

/**
 * AudioPlayer 上 set_proxy 已在 Rust 端实现，对应的 d.ts 声明会在下次
 * `pnpm build:native` 时由 NAPI-RS 自动重新生成；在此之前用类型断言访问
 */
type PlayerInstanceWithProxy = PlayerInstance & {
  setProxy: (proxyUrl: string | null) => void;
};

/** 安全下发 setProxy 调用，避免 d.ts 未同步时类型报错 */
const callSetProxy = (inst: PlayerInstance, url: string | null): void => {
  (inst as unknown as PlayerInstanceWithProxy).setProxy(url);
};

let audioEngine: AudioEngineModule | null = null;
let playerInstance: PlayerInstance | null = null;

/** 实例创建后的回调列表（注册事件、启动轮询等） */
const onCreatedCallbacks: Array<(inst: PlayerInstance) => void> = [];

/** 获取原生音频引擎模块 */
export const getEngine = (): AudioEngineModule => {
  if (!audioEngine) {
    audioEngine = loadNativeModule<AudioEngineModule>("audio-engine.node", "audio-engine");
    if (!audioEngine) {
      throw new Error("Failed to load audio-engine.node");
    }
    audioEngine.initLogger(nativeLogsDir, isDev);
  }
  return audioEngine;
};

/**
 * 注册播放器实例创建后的回调（在创建/重建时都会触发）
 * 在 getPlayer 首次调用前注册
 */
export const onPlayerCreated = (callback: (inst: PlayerInstance) => void): void => {
  onCreatedCallbacks.push(callback);
};

/** 获取播放器实例 */
export const getPlayer = (): PlayerInstance => {
  if (!playerInstance) {
    const mod = getEngine();
    playerInstance = new mod.AudioPlayer();
    playerInstance.setCoverCacheDir(getCoverCacheDir());
    for (const cb of onCreatedCallbacks) {
      cb(playerInstance);
    }
    playerLog.info("播放器实例已创建");
  }
  return playerInstance;
};

/** 销毁播放器实例，下次 getPlayer 时自动重建 */
export const resetPlayer = (): void => {
  if (playerInstance) {
    try {
      playerInstance.stop();
    } catch {
      // 设备已丢失时 stop 可能失败，忽略
    }
  }
  playerLog.warn("销毁播放器实例，将在下次操作时重建");
  playerInstance = null;
};

/** 同步音量均衡设置到播放器 */
export const setNormalizationEnabled = (enabled: boolean): void => {
  if (playerInstance) {
    playerInstance.setNormalizationEnabled(enabled);
  }
};

/** 同步均衡器开关到播放器 */
export const setEqualizerEnabled = (enabled: boolean): void => {
  if (playerInstance) {
    playerInstance.setEqualizerEnabled(enabled);
  }
};

/** 同步均衡器频段增益到播放器 */
export const setEqualizerBands = (gainsDb: number[]): void => {
  if (playerInstance) {
    playerInstance.setEqualizerBands(gainsDb);
  }
};

/** 同步前级增益到播放器 */
export const setPreampGain = (preampDb: number): void => {
  if (playerInstance) {
    playerInstance.setPreampGain(preampDb);
  }
};

/** 音频超分后端编码（与 Rust 侧 SuperResBackend::to_u8 对齐） */
export type SuperResBackendCode = 0 | 1 | 2;

/**
 * 待下发的音频超分配置
 *
 * playerInstance 为 null 时（resetPlayer 后重建场景）暂存于此，
 * onPlayerCreated 回调触发时再下发，避免配置丢失导致超分静默关闭
 */
let pendingAudioSuperResolution: {
  enabled: boolean;
  backend: SuperResBackendCode;
  params: SuperResParams;
} | null = null;

/**
 * 同步音频超分开关、后端与参数到播放器
 * @param enabled - 是否启用
 * @param backend - 0=CPU, 1=GPU, 2=NPU（GPU/NPU 当前回退到 CPU）
 * @param params - 超分参数（高通/激励/混合等）
 */
export const setAudioSuperResolution = (
  enabled: boolean,
  backend: SuperResBackendCode,
  params: SuperResParams,
): void => {
  pendingAudioSuperResolution = { enabled, backend, params };
  if (playerInstance) {
    playerInstance.setAudioSuperResolution(enabled, backend, params);
  }
};

/** 实例创建后重下发暂存的超分配置（覆盖 resetPlayer 重建场景） */
onPlayerCreated((inst) => {
  if (pendingAudioSuperResolution) {
    inst.setAudioSuperResolution(
      pendingAudioSuperResolution.enabled,
      pendingAudioSuperResolution.backend,
      pendingAudioSuperResolution.params,
    );
  }
});

/** 取音频超分当前实际生效后端（GPU/NPU 不可用时回退为 0=CPU） */
export const getAudioSuperResolutionEffectiveBackend = (): SuperResBackendCode => {
  if (!playerInstance) return 0;
  return playerInstance.getAudioSuperResolutionEffectiveBackend() as SuperResBackendCode;
};

/**
 * 待下发的低音增强配置（resetPlayer 重建场景暂存）
 */
let pendingBassEnhancer: { enabled: boolean; params: BassEnhancerSettings } | null = null;

/**
 * 同步低音增强开关与参数到播放器
 * @param enabled - 是否启用
 * @param params - 低音增强参数（freq / gainDb / q / harmonicsMix / bypass）
 */
export const setBassEnhancer = (enabled: boolean, params: BassEnhancerSettings): void => {
  // BassEnhancerSettings 包含 enabled 字段；native 侧只需 freq/gainDb/q/harmonicsMix/bypass
  pendingBassEnhancer = { enabled, params };
  if (playerInstance) {
    playerInstance.setBassEnhancer(enabled, {
      freq: params.freq,
      gainDb: params.gainDb,
      q: params.q,
      harmonicsMix: params.harmonicsMix,
      bypass: params.bypass,
    });
  }
};

onPlayerCreated((inst) => {
  if (pendingBassEnhancer) {
    inst.setBassEnhancer(pendingBassEnhancer.enabled, {
      freq: pendingBassEnhancer.params.freq,
      gainDb: pendingBassEnhancer.params.gainDb,
      q: pendingBassEnhancer.params.q,
      harmonicsMix: pendingBassEnhancer.params.harmonicsMix,
      bypass: pendingBassEnhancer.params.bypass,
    });
  }
});

/**
 * 待下发的立体声展宽配置（resetPlayer 重建场景暂存）
 */
let pendingStereoWidener: { enabled: boolean; params: StereoWidenerSettings } | null = null;

/**
 * 同步立体声展宽开关与参数到播放器
 * @param enabled - 是否启用
 * @param params - 立体声展宽参数（width / crossFeed / haasEnabled / bypass）
 */
export const setStereoWidener = (enabled: boolean, params: StereoWidenerSettings): void => {
  pendingStereoWidener = { enabled, params };
  if (playerInstance) {
    playerInstance.setStereoWidener(enabled, {
      width: params.width,
      crossFeed: params.crossFeed,
      haasEnabled: params.haasEnabled,
      bypass: params.bypass,
    });
  }
};

onPlayerCreated((inst) => {
  if (pendingStereoWidener) {
    inst.setStereoWidener(pendingStereoWidener.enabled, {
      width: pendingStereoWidener.params.width,
      crossFeed: pendingStereoWidener.params.crossFeed,
      haasEnabled: pendingStereoWidener.params.haasEnabled,
      bypass: pendingStereoWidener.params.bypass,
    });
  }
});

/**
 * 待下发的响度归一化配置（resetPlayer 重建场景暂存）
 */
let pendingLoudnessNormalizer: { enabled: boolean; params: LoudnessNormalizerSettings } | null =
  null;

/**
 * 同步响度归一化开关与参数到播放器
 * @param enabled - 是否启用
 * @param params - 响度归一化参数（targetLufs / maxGainDb / bypass）
 */
export const setLoudnessNormalizer = (
  enabled: boolean,
  params: LoudnessNormalizerSettings,
): void => {
  pendingLoudnessNormalizer = { enabled, params };
  if (playerInstance) {
    playerInstance.setLoudnessNormalizer(enabled, {
      targetLufs: params.targetLufs,
      maxGainDb: params.maxGainDb,
      bypass: params.bypass,
    });
  }
};

onPlayerCreated((inst) => {
  if (pendingLoudnessNormalizer) {
    inst.setLoudnessNormalizer(pendingLoudnessNormalizer.enabled, {
      targetLufs: pendingLoudnessNormalizer.params.targetLufs,
      maxGainDb: pendingLoudnessNormalizer.params.maxGainDb,
      bypass: pendingLoudnessNormalizer.params.bypass,
    });
  }
});

/** 神经网络上采样后端编码（与 Rust 侧 NeuralBackend::to_u8 对齐） */
export type NeuralBackendCode = 0 | 1;

/**
 * 待下发的神经网络上采样配置（resetPlayer 重建场景暂存）
 */
let pendingNeuralUpsample: {
  enabled: boolean;
  backend: NeuralBackendCode;
  params: NeuralUpsampleSettings["params"];
} | null = null;

/**
 * 同步神经网络上采样开关、后端与参数到播放器
 * @param enabled - 是否启用
 * @param backend - 0=Fallback 算法兜底，1=ONNX Runtime（Onnx 后端仅在模型加载成功时才生效）
 * @param params - 上采样参数（inputGainDb / wetMix / bypass）
 */
export const setNeuralUpsample = (
  enabled: boolean,
  backend: NeuralBackendCode,
  params: NeuralUpsampleSettings["params"],
): void => {
  pendingNeuralUpsample = { enabled, backend, params };
  if (playerInstance) {
    playerInstance.setNeuralUpsample(enabled, backend, {
      inputGainDb: params.inputGainDb,
      wetMix: params.wetMix,
      bypass: params.bypass,
    });
  }
};

onPlayerCreated((inst) => {
  if (pendingNeuralUpsample) {
    inst.setNeuralUpsample(pendingNeuralUpsample.enabled, pendingNeuralUpsample.backend, {
      inputGainDb: pendingNeuralUpsample.params.inputGainDb,
      wetMix: pendingNeuralUpsample.params.wetMix,
      bypass: pendingNeuralUpsample.params.bypass,
    });
  }
});

/**
 * 加载 ONNX 模型到原生引擎
 * @param path - 模型文件绝对路径
 * @returns 加载成功返回 true，失败返回 false（前端可提示用户检查模型文件）
 */
export const loadNeuralModel = (path: string): boolean => {
  if (!playerInstance) return false;
  return playerInstance.loadNeuralModel(path);
};

/** 取已加载的 ONNX 模型路径（null = 未加载） */
export const getNeuralModelPath = (): string | null => {
  if (!playerInstance) return null;
  return playerInstance.getNeuralModelPath();
};

/** 取神经网络上采样当前实际生效后端（Onnx 模型未加载时回退为 0=Fallback） */
export const getNeuralUpsampleEffectiveBackend = (): NeuralBackendCode => {
  if (!playerInstance) return 0;
  return playerInstance.getNeuralUpsampleEffectiveBackend() as NeuralBackendCode;
};

/** 同步当前封面缓存目录到原生引擎（缓存路径切换时调用） */
export const syncCoverCacheDir = (): void => {
  if (playerInstance) {
    playerInstance.setCoverCacheDir(getCoverCacheDir());
  }
};

/**
 * 待下发的代理 URL（resetPlayer 重建场景暂存）
 * null 表示显式关闭代理；调用过 setProxy 后此值始终反映最新期望状态
 */
let pendingProxyUrl: string | null = null;

/**
 * 构造代理 URL 字符串（供 Rust 端 ureq::Proxy 解析使用）
 * @param proxy - 代理配置；protocol=off 或 host 为空时返回 null
 * @returns 形如 `http://user:pass@host:port` / `socks5://host:port` 的 URL，或 null
 */
export const buildProxyUrl = (proxy: ProxySettings): string | null => {
  if (proxy.protocol === "off" || !proxy.host) return null;
  const proto = proxy.protocol === "socks" ? "socks5" : proxy.protocol;
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : "";
  return `${proto}://${auth}${proxy.host}:${proxy.port}`;
};

/**
 * 同步代理配置到原生引擎
 * @param proxy - 代理配置；protocol=off 或 host 为空时关闭代理
 */
export const setProxy = (proxy: ProxySettings): void => {
  const url = buildProxyUrl(proxy);
  pendingProxyUrl = url;
  if (playerInstance) {
    callSetProxy(playerInstance, url);
  }
};

onPlayerCreated((inst) => {
  callSetProxy(inst, pendingProxyUrl);
});

/**
 * 待下发的 FFT 等响度补偿开关（resetPlayer 重建场景暂存）
 * Rust 侧默认 true，这里只在用户显式关闭时保存 false，重建后仍生效
 */
let pendingFftEqualLoudness: boolean | null = null;

/**
 * 同步 FFT 等响度补偿开关到播放器
 * @param enabled - 是否启用等响度补偿（20Hz gain=1.0 → 20kHz gain=12.0 对数插值）
 */
export const setFftEqualLoudness = (enabled: boolean): void => {
  pendingFftEqualLoudness = enabled;
  if (playerInstance) {
    playerInstance.setFftEqualLoudness(enabled);
  }
};

onPlayerCreated((inst) => {
  if (pendingFftEqualLoudness !== null) {
    inst.setFftEqualLoudness(pendingFftEqualLoudness);
  }
});

/**
 * 待下发的空间音频配置（resetPlayer 重建场景暂存）
 *
 * 空间音频是"宏开关"：开启时用预设值一次性配置 StereoWidener + BassEnhancer + SuperRes
 * 三个 DSP，制造包裹感。注册在所有独立 DSP pending 之后，确保重建时最后执行、
 * 覆盖各子项独立配置。关闭时不干预各子项，由各自的 setter 决定生效状态。
 */
let pendingSpatialAudio: SpatialAudioSettings | null = null;

/**
 * 由空间音频配置派生超分参数（复用用户的高通/限幅基础值，仅替换 drive / wetMix）
 * @param params - 空间音频参数
 * @param userSuperRes - 用户在超分面板里配置的基础参数（hpFreq / hpQ / h2Drive / inputLimit 沿用）
 */
const deriveSuperResParams = (
  params: SpatialAudioSettings,
  userSuperRes: SuperResParams,
): SuperResParams => ({
  hpFreq: userSuperRes.hpFreq,
  hpQ: userSuperRes.hpQ,
  drive: params.superResDrive,
  h2Drive: userSuperRes.h2Drive,
  h2Mix: 0.15,
  wetMix: params.superResWetMix,
  inputLimit: userSuperRes.inputLimit,
  bypass: params.bypass,
});

/**
 * 同步空间音频配置到播放器
 *
 * 开启时：启用并配置 StereoWidener + BassEnhancer + SuperRes 三个 DSP（覆盖各自独立配置）
 * 关闭时：不干预各子项——由各自的 setter 决定生效状态（initPlayer 会单独下发）
 *
 * @param params - 空间音频参数；enabled=true 时按预设值配置三个 DSP
 * @param userSuperRes - 用户在超分面板里配置的基础超分参数（仅用于派生 hpFreq / hpQ 等基础项）
 */
export const setSpatialAudio = (
  params: SpatialAudioSettings,
  userSuperRes?: SuperResParams,
): void => {
  pendingSpatialAudio = params;
  if (!playerInstance) return;
  if (!params.enabled || params.bypass) return;
  // 派生各子项参数并下发——空间音频开启时强制三个 DSP 都启用
  const superResBase: SuperResParams = userSuperRes ?? {
    hpFreq: 4500,
    hpQ: 0.7,
    drive: params.superResDrive,
    h2Drive: 0.6,
    h2Mix: 0.15,
    wetMix: params.superResWetMix,
    inputLimit: 1.2,
    bypass: false,
  };
  const bassParams: BassEnhancerSettings = {
    enabled: true,
    freq: params.bassFreq,
    gainDb: params.bassGainDb,
    q: 0.7,
    harmonicsMix: 0.45,
    bypass: params.bypass,
  };
  const stereoParams: StereoWidenerSettings = {
    enabled: true,
    width: params.width,
    crossFeed: 0.15,
    haasEnabled: true,
    bypass: params.bypass,
  };
  // 同步更新 pending，避免 resetPlayer 重建时落下空间音频配置
  pendingAudioSuperResolution = {
    enabled: true,
    backend: 0,
    params: deriveSuperResParams(params, superResBase),
  };
  pendingBassEnhancer = { enabled: true, params: bassParams };
  pendingStereoWidener = { enabled: true, params: stereoParams };
  playerInstance.setAudioSuperResolution(true, 0, pendingAudioSuperResolution.params);
  playerInstance.setBassEnhancer(true, bassParams);
  playerInstance.setStereoWidener(true, stereoParams);
};

// 重建时最后执行，覆盖各独立 DSP 的 pending 配置
onPlayerCreated((inst) => {
  if (!pendingSpatialAudio || !pendingSpatialAudio.enabled || pendingSpatialAudio.bypass) return;
  inst.setAudioSuperResolution(true, 0, pendingAudioSuperResolution!.params);
  inst.setBassEnhancer(true, pendingBassEnhancer!.params);
  inst.setStereoWidener(true, pendingStereoWidener!.params);
});