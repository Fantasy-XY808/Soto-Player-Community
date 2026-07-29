/**
 * 渲染捕获核心逻辑（DOM capturePage + AnalyserNode FFT + 时间源驱动）
 *
 * 流程：
 * 1. 主进程下发 renderVideo:config → 设置 audioUrl、track、format、width、height、fps、bitrate
 * 2. 创建 <audio> 元素加载 audioUrl（不挂载到 DOM）
 * 3. AudioContext + createMediaElementSource → AnalyserNode → MediaStreamDestination
 *    - AnalyserNode 用于本地提取 FFT 喂给 playback.setFftFrame（驱动频谱/呼吸/流体背景）
 *    - MediaStreamDestination 提供音频流给 MediaRecorder
 * 4. 主进程通过 captureFrame IPC 截取渲染窗口真实 DOM（FullPlayer 全套视觉）
 *    - 渲染窗口拿到 PNG data URL → 创建 Image → drawImage 到隐藏 canvas
 *    - canvas.captureStream(fps) 自动捕获新帧生成视频流
 * 5. new MediaStream([...videoTracks, ...audioTracks])
 * 6. MediaRecorder + timeslice → ondataavailable → IPC renderVideo:chunk
 * 7. 主循环按 fps 间隔：
 *    - captureFrame → drawImage（驱动视频流）
 *    - analyser.getByteFrequencyData → playback.setFftFrame（驱动频谱）
 *    - audioEl.currentTime * 1000 → playback.setCurrentTime（驱动歌词逐字高亮）
 * 8. 监听 audio.ended → 停止 recorder → final chunk → IPC renderVideo:finished
 *
 * 视觉完全复用主播放界面：封面、歌词、频谱、流体背景、液态玻璃控件等
 * 全部由 FullPlayer 渲染，渲染窗口只负责逐帧截图喂给 MediaRecorder。
 */

import { ref, type Ref } from "vue";
import type { RenderWindowConfig } from "@shared/types/renderVideo";
import * as playback from "@/services/playback";
import { useStatusStore } from "@/stores/status";

/** 当前下发的渲染配置 */
const config: Ref<RenderWindowConfig | null> = ref(null);

/** 渲染状态：是否正在录制 */
const isRecording = ref(false);

/** 当前已渲染时长（毫秒） */
const renderedMs = ref(0);

/** 总时长（毫秒） */
const durationMs = ref(0);

/** 错误信息 */
const errorMessage = ref<string | null>(null);

/** 音频元素 */
let audioEl: HTMLAudioElement | null = null;

/** AudioContext */
let audioCtx: AudioContext | null = null;

/** AnalyserNode：从音频流提取 FFT 数据 */
let analyser: AnalyserNode | null = null;

/** Uint8Array：承接 analyser.getByteFrequencyData 的输出 */
let fftUint8: Uint8Array<ArrayBuffer> | null = null;

/** 复用 number[] 缓冲：pumpFft 每帧把 Uint8Array 拷贝进来注入 playback.setFftFrame */
let fftFrameBuffer: number[] = [];

/** Canvas 元素（用于接收 captureFrame 截图并生成视频流） */
let canvasEl: HTMLCanvasElement | null = null;

/** Canvas 2D context */
let canvasCtx: CanvasRenderingContext2D | null = null;

/** MediaRecorder 实例 */
let recorder: MediaRecorder | null = null;

/** 取消标志 */
let canceled = false;

/** 收尾标志：audio.ended 后进入收尾阶段，允许 dataavailable 继续处理 */
let isFinishing = false;

/** pending chunks 列表：onstop 必须等待所有 chunk 发送完成才能发 finished
 *
 * MediaRecorder.ondataavailable 是异步回调，stop() 调用后会触发最后一个 dataavailable，
 * 然后才触发 onstop。但 IPC 异步传输意味着主进程收到的顺序可能颠倒：
 * 最后一个大数据分片（1-2MB）可能还在异步队列时主进程就收到 finished → writeStream.end() → write after end
 * → 最后分片丢失 → 产物只有几KB
 *
 * 通过 pendingChunks 跟踪每个 chunk 的发送 Promise，onstop 等待全部完成再发 finished
 */
const pendingChunks: Promise<void>[] = [];

/** 主循环定时器 ID */
let loopTimer: ReturnType<typeof setTimeout> | null = null;

/** 最后一次进度上报时间（节流） */
let lastProgressSent = 0;

const PROGRESS_THROTTLE_MS = 200;

/** status.position 写入节流间隔（ms）
 *
 * FullPlayer 进度条绑定 status.position（computed(() => status.position)），
 * 主循环每帧（~30-60fps）调用 playback.setCurrentTime 推进非响应式时间源驱动歌词，
 * 但 status.position 必须同步推进才能让底栏进度条/时间标签更新。
 *
 * 节流到 ~10Hz 避免 60fps 写入触发 FullPlayer 全量重渲染（开发者已在 FullPlayer
 * 第 70 行注释标明 position 局部化的初衷）。
 */
const POSITION_SYNC_INTERVAL_MS = 100;
let lastPositionSync = 0;

/** FFT 频率桶数（与主进程 audio-engine 推送长度一致） */
const FFT_BINS = 128;

/**
 * 选择 MediaRecorder 支持的 MIME 类型
 */
const pickMimeType = (format: "webm" | "mp4"): string => {
  const candidates: string[] = [];
  if (format === "mp4") {
    candidates.push("video/mp4;codecs=h264,aac");
    candidates.push("video/mp4;codecs=avc1.42E01E,mp4a.40.2");
    candidates.push("video/mp4");
  } else {
    candidates.push("video/webm;codecs=vp9,opus");
    candidates.push("video/webm;codecs=vp8,opus");
    candidates.push("video/webm");
  }
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return format === "mp4" ? "video/mp4" : "video/webm";
};

/**
 * 发送分片到主进程
 */
const sendChunk = (taskId: string, data: ArrayBuffer, final: boolean): void => {
  try {
    window.api.renderVideo.sendChunk(taskId, data, final);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[ERR-70007-F] sendChunk 失败 taskId=${taskId}`, err);
  }
};

/**
 * 发送进度（节流）
 */
const sendProgress = (taskId: string, ms: number): void => {
  const now = performance.now();
  if (now - lastProgressSent < PROGRESS_THROTTLE_MS) return;
  lastProgressSent = now;
  try {
    window.api.renderVideo.sendProgress(taskId, ms);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[ERR-70007-G] sendProgress 失败 taskId=${taskId}`, err);
  }
};

/**
 * 通知当前曲目完成
 */
const sendFinished = (taskId: string): void => {
  try {
    window.api.renderVideo.sendFinished(taskId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[ERR-70001-R] sendFinished 失败 taskId=${taskId}`, err);
  }
};

/**
 * 通知错误
 */
const sendError = (taskId: string, message: string): void => {
  try {
    window.api.renderVideo.sendError(taskId, message);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[ERR-70005-B] sendError 失败 taskId=${taskId}`, err);
  }
};

/**
 * 从 AnalyserNode 提取 FFT 数据并注入 playback 服务
 *
 * AnalyserNode.frequencyBinCount = fftSize / 2
 * 设置 fftSize = FFT_BINS * 2 = 256，得到 128 个频率桶，与主进程 audio-engine 推送长度一致
 * BottomSpectrum/BackgroundRender 通过 playback.getFftFrame() 读取
 */
const pumpFft = (): void => {
  if (!analyser || !fftUint8) return;
  analyser.getByteFrequencyData(fftUint8);
  // 复用预分配 frame buffer，避免每帧 Array.from(fftUint8) 创建新数组（高频 GC）
  // playback.setFftFrame 直接保存数组引用，下一帧覆盖时已通过播放器内部门控
  if (fftFrameBuffer.length !== fftUint8.length) {
    fftFrameBuffer = new Array<number>(fftUint8.length);
  }
  for (let i = 0; i < fftUint8.length; i++) fftFrameBuffer[i] = fftUint8[i];
  playback.setFftFrame(fftFrameBuffer);
};

/**
 * 请求主进程捕获渲染窗口画面，drawImage 到 canvas
 *
 * captureFrame 返回 PNG data URL（base64）：
 * 1. 创建 Image 对象加载 data URL
 * 2. 加载完成后 drawImage 到 canvas（保持原始尺寸）
 * 3. canvas.captureStream(fps) 自动捕获新帧生成视频流
 *
 * 失败时（窗口销毁 / 截图为空）跳过本帧，等待下次循环
 */
const pumpFrame = async (): Promise<void> => {
  if (!canvasCtx || !canvasEl) return;
  try {
    const dataUrl = await window.api.renderVideo.captureFrame();
    if (!dataUrl) {
      // captureFrame 返回空字符串：窗口已销毁或截图为空
      return;
    }
    // 创建 Image 加载 data URL
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = (): void => resolve();
      img.onerror = (): void => reject(new Error("[ERR-70006-I] Image load failed"));
      img.src = dataUrl;
    });
    // 绘制到 canvas（保持原始尺寸，与 cfg.width/cfg.height 一致）
    canvasCtx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
  } catch (err) {
    // 单帧截图失败不中断渲染，仅记录日志
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[ERR-70006-J] pumpFrame 单帧失败: ${message}`);
  }
};

/**
 * 主循环：按 fps 间隔驱动 captureFrame + FFT + 时间源
 *
 * 使用 setTimeout 而非 requestAnimationFrame：
 * - 渲染窗口 show:false，document.hidden=true 时 RAF 被节流到 ~1Hz
 * - 即使 main.ts 覆写了 document.hidden，RAF 仍受窗口可见性影响
 * - setTimeout 不受可见性影响，能保证稳定 fps
 *
 * 链式 setTimeout：上一帧完成后才调度下一帧，避免帧叠加
 */
const loop = (cfg: RenderWindowConfig): void => {
  if (canceled || isFinishing) return;
  if (!audioEl) return;
  // 推进时间源（force=true，避免与 playback 内部插值冲突）
  const currentMs = audioEl.currentTime * 1000;
  renderedMs.value = currentMs;
  playback.setCurrentTime(currentMs, { force: true });
  // 同步 status.position（节流到 ~10Hz，避免高频响应式触发 FullPlayer 全量重渲染）
  // FullPlayer 底栏进度条/时间标签绑定 status.position，不同步则永远显示 0:00
  const now = performance.now();
  if (now - lastPositionSync >= POSITION_SYNC_INTERVAL_MS) {
    lastPositionSync = now;
    useStatusStore().position = currentMs;
  }
  // 推送进度（节流）
  sendProgress(cfg.taskId, currentMs);
  // 提取 FFT 喂给频谱/流体背景
  pumpFft();
  // 截图并绘制到 canvas（异步）
  void pumpFrame().finally(() => {
    if (canceled || isFinishing) return;
    // 按 fps 间隔调度下一帧
    const interval = Math.max(16, Math.floor(1000 / cfg.fps));
    loopTimer = setTimeout(() => loop(cfg), interval);
  });
};

/**
 * 启动渲染
 */
const startRender = async (cfg: RenderWindowConfig): Promise<void> => {
  // eslint-disable-next-line no-console
  console.info(
    `[ERR-70005-C] 启动渲染 taskId=${cfg.taskId} audioUrl=${cfg.audioUrl.slice(0, 80)}... track=${cfg.track.title}`,
  );
  config.value = cfg;
  canceled = false;
  isFinishing = false;
  pendingChunks.length = 0;
  errorMessage.value = null;
  renderedMs.value = 0;
  durationMs.value = cfg.track.duration ?? 0;

  try {
    // 1. 创建 audio 元素
    audioEl = new Audio();
    audioEl.crossOrigin = "anonymous";
    audioEl.src = cfg.audioUrl;
    audioEl.preload = "auto";
    // eslint-disable-next-line no-console
    console.info(`[ERR-70005-D] audio 元素已创建 src=${cfg.audioUrl.slice(0, 100)}`);

    // 等待音频元数据加载
    await new Promise<void>((resolve, reject) => {
      if (!audioEl) return reject(new Error("[ERR-70005-E] Audio element not created"));
      audioEl.addEventListener("loadedmetadata", () => resolve(), { once: true });
      audioEl.addEventListener(
        "error",
        () => {
          const err = audioEl?.error;
          const detail = err
            ? `code=${err.code} message=${err.message ?? ""}`
            : "no error detail";
          reject(new Error(`[ERR-70005-F] Audio load failed (${detail})`));
        },
        { once: true },
      );
    });
    // eslint-disable-next-line no-console
    console.info("[ERR-70005-G] 音频元数据已加载");

    // 更新时长
    durationMs.value = audioEl.duration ? audioEl.duration * 1000 : cfg.track.duration ?? 0;

    // 2. 创建 AudioContext + AnalyserNode + MediaStreamDestination
    audioCtx = new AudioContext();
    // 独立渲染窗口无用户激活，AudioContext 可能以 suspended 状态启动
    // suspended 会导致 createMediaElementSource 接管 audio 输出后 currentTime 不推进
    // → audio.ended 永不触发 → sendFinished 永不到达 → 任务死等
    if (audioCtx.state === "suspended") {
      try {
        await audioCtx.resume();
        // eslint-disable-next-line no-console
        console.info(`[ERR-70005-H2] AudioContext 已 resume state=${audioCtx.state}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[ERR-70005-K] AudioContext resume 失败`, err);
      }
    }
    const source = audioCtx.createMediaElementSource(audioEl);
    // AnalyserNode：fftSize = 256 → frequencyBinCount = 128（与主进程 FFT 长度一致）
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_BINS * 2;
    analyser.smoothingTimeConstant = 0.6;
    fftUint8 = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    const dest = audioCtx.createMediaStreamDestination();
    // 音频流路径：source → analyser → dest
    // analyser 不会修改通过的音频，dest 拿到与 source 一致的音频流
    source.connect(analyser);
    analyser.connect(dest);
    // 不连接到 audioCtx.destination，渲染时不播放声音
    // eslint-disable-next-line no-console
    console.info(
      `[ERR-70005-H] AudioContext 已创建 state=${audioCtx.state} sampleRate=${audioCtx.sampleRate} fftSize=${analyser.fftSize}`,
    );

    // 3. 创建 canvas（仅作为 captureStream 源，FullPlayer 通过 capturePage 截图喂入）
    canvasEl = document.createElement("canvas");
    canvasEl.width = cfg.width;
    canvasEl.height = cfg.height;
    canvasCtx = canvasEl.getContext("2d", { alpha: false });
    if (!canvasCtx) throw new Error("[ERR-70006-A] Canvas 2D context not available");
    // 初始填充黑色，避免首帧空白
    canvasCtx.fillStyle = "#000";
    canvasCtx.fillRect(0, 0, cfg.width, cfg.height);
    // eslint-disable-next-line no-console
    console.info(`[ERR-70006-B] Canvas 已创建 ${cfg.width}x${cfg.height}`);

    // 4. 创建视频流
    const videoStream = canvasEl.captureStream(cfg.fps);
    const audioTracks = dest.stream.getAudioTracks();
    const combinedStream = new MediaStream([
      ...videoStream.getVideoTracks(),
      ...audioTracks,
    ]);

    // 5. 创建 MediaRecorder
    const mimeType = pickMimeType(cfg.format);
    const options: MediaRecorderOptions = {
      mimeType,
      videoBitsPerSecond: cfg.videoBitrate > 0 ? cfg.videoBitrate : 8_000_000,
      audioBitsPerSecond: 192_000,
    };
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      // eslint-disable-next-line no-console
      console.warn(`[ERR-70006-C] MIME 类型不被支持: ${mimeType}`);
    }
    try {
      recorder = new MediaRecorder(combinedStream, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[ERR-70006-D] MediaRecorder 创建失败: ${message}`);
    }
    // eslint-disable-next-line no-console
    console.info(`[ERR-70006-E] MediaRecorder 已创建 mimeType=${mimeType}`);

    // 分片大小：每秒一个分片
    const timeslice = 1000;

    recorder.ondataavailable = (evt: BlobEvent): void => {
      if (evt.data.size === 0) return;
      if (canceled && !isFinishing) return;
      // Blob → ArrayBuffer → IPC
      // 跟踪每个 pending chunk，确保 onstop 等到所有分片发送完成
      const chunkPromise = evt.data
        .arrayBuffer()
        .then((buf: ArrayBuffer) => {
          sendChunk(cfg.taskId, buf, false);
        })
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`[ERR-70007-H] arrayBuffer 转换失败 taskId=${cfg.taskId}`, err);
        });
      pendingChunks.push(chunkPromise);
    };

    recorder.onstop = (): void => {
      // eslint-disable-next-line no-console
      console.info(`[ERR-70006-F] MediaRecorder 停止 taskId=${cfg.taskId}`);
      // 必须等待所有 pending chunk 发送完成再发 finished 信号
      // 否则最后一个大数据分片（通常 1-2MB）还在异步队列时主进程就收到 finished
      // → writeStream.end() 关闭流 → 最后分片到达触发 write after end → 数据丢失
      // 用户反馈"渲染有时正常有时几KB"就是这个 race condition 导致的
      void Promise.all(pendingChunks)
        .then(() => {
          // 所有分片已发送，发结束标志（空分片 + final=true）
          sendChunk(cfg.taskId, new ArrayBuffer(0), true);
          // 通知完成
          sendFinished(cfg.taskId);
          isRecording.value = false;
        })
        .catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error(`[ERR-70006-I2] pending chunks 等待失败 taskId=${cfg.taskId}`, err);
          sendError(cfg.taskId, `[ERR-70006-I2] chunks flush failed: ${String(err)}`);
        });
    };

    recorder.onerror = (evt: Event): void => {
      const errEvent = evt as ErrorEvent;
      const err = errEvent.error ?? new Error("Recorder error");
      // eslint-disable-next-line no-console
      console.error(`[ERR-70006-G] MediaRecorder 错误 taskId=${cfg.taskId}`, err);
      sendError(cfg.taskId, `[ERR-70006-G] ${err.message ?? String(err)}`);
    };

    // 监听 audio ended
    audioEl.addEventListener("ended", () => {
      // eslint-disable-next-line no-console
      console.info(`[ERR-70005-I] 音频播放结束 taskId=${cfg.taskId}`);
      // 进入收尾阶段：停止 loop 主循环避免继续截图，但允许 dataavailable 继续处理
      // （最后一个分片可能还在异步队列中，必须让 onstop 等待其完成）
      isFinishing = true;
      if (loopTimer) {
        clearTimeout(loopTimer);
        loopTimer = null;
      }
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    });

    // 启动录制
    recorder.start(timeslice);
    isRecording.value = true;
    // eslint-disable-next-line no-console
    console.info(`[ERR-70006-H] MediaRecorder 已启动 timeslice=${timeslice}ms`);

    // 启动音频播放（无声）
    await audioEl.play();
    // eslint-disable-next-line no-console
    console.info(`[ERR-70005-J] 音频开始播放 taskId=${cfg.taskId}`);
    // 启动主循环（captureFrame + FFT + 时间源）
    loop(cfg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error(`[ERR-70015-B] 渲染启动失败 taskId=${cfg.taskId} → ${message}`, err);
    errorMessage.value = message;
    sendError(cfg.taskId, message);
    cleanup();
  }
};

/**
 * 取消渲染
 */
const cancelRender = (): void => {
  canceled = true;
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  if (recorder && recorder.state !== "inactive") {
    try {
      recorder.stop();
    } catch {
      // 忽略
    }
  }
  if (audioEl) {
    audioEl.pause();
  }
  cleanup();
};

/**
 * 清理资源
 */
const cleanup = (): void => {
  isRecording.value = false;
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  audioEl = null;
  analyser = null;
  fftUint8 = null;
  canvasEl = null;
  canvasCtx = null;
  recorder = null;
  config.value = null;
  lastPositionSync = 0;
  lastProgressSent = 0;
};

/**
 * 渲染捕获 composable
 */
export const useRenderCapture = () => {
  return {
    config,
    isRecording,
    renderedMs,
    durationMs,
    errorMessage,
    startRender,
    cancelRender,
  };
};
