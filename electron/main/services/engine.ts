import { loadNativeModule } from "@main/utils/nativeLoader";
import { getCoverCacheDir, isDev } from "@main/utils/config";
import { playerLog, nativeLogsDir } from "@main/utils/logger";

type AudioEngineModule = typeof import("@splayer/audio-engine");
type PlayerInstance = InstanceType<AudioEngineModule["AudioPlayer"]>;

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
let pendingAudioSuperResolution: { enabled: boolean; backend: SuperResBackendCode } | null = null;

/**
 * 同步音频超分开关与后端到播放器
 * @param enabled - 是否启用
 * @param backend - 0=CPU, 1=GPU, 2=NPU（GPU/NPU 当前回退到 CPU）
 */
export const setAudioSuperResolution = (enabled: boolean, backend: SuperResBackendCode): void => {
  pendingAudioSuperResolution = { enabled, backend };
  if (playerInstance) {
    playerInstance.setAudioSuperResolution(enabled, backend);
  }
};

/** 实例创建后重下发暂存的超分配置（覆盖 resetPlayer 重建场景） */
onPlayerCreated((inst) => {
  if (pendingAudioSuperResolution) {
    inst.setAudioSuperResolution(
      pendingAudioSuperResolution.enabled,
      pendingAudioSuperResolution.backend,
    );
  }
});

/** 取音频超分当前实际生效后端（GPU/NPU 不可用时回退为 0=CPU） */
export const getAudioSuperResolutionEffectiveBackend = (): SuperResBackendCode => {
  if (!playerInstance) return 0;
  return playerInstance.getAudioSuperResolutionEffectiveBackend() as SuperResBackendCode;
};

/** 同步当前封面缓存目录到原生引擎（缓存路径切换时调用） */
export const syncCoverCacheDir = (): void => {
  if (playerInstance) {
    playerInstance.setCoverCacheDir(getCoverCacheDir());
  }
};
