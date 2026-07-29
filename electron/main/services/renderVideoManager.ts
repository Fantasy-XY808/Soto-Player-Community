/**
 * 视频渲染任务管理服务
 *
 * 主窗口 → renderVideo:start → 创建/复用渲染窗口 → 渲染窗口捕获 → 分片回传 → 主进程落盘
 * 任务权威态在主进程，进度/状态经 broadcast 推送给主窗口镜像。
 *
 * 简化策略：
 * - 渲染窗口同时只能执行一个任务，后续任务排队
 * - 主窗口在 start 前预先解析好音频 URL（避免主进程依赖渲染层逻辑）
 * - 渲染窗口通过 IPC 把 Blob 分片发回主进程，主进程拼接到文件流
 *
 * 错误码约定：[ERR-70XXX-X]
 * - 70001: 窗口创建/关闭相关
 * - 70002: 窗口加载/崩溃相关
 * - 70003: 窗口 ready 超时
 * - 70004: 音频 URL 解析/缺失
 * - 70005: 音频加载失败（渲染窗口回报）
 * - 70006: MediaRecorder/Canvas 捕获失败
 * - 70007: 文件写入失败
 * - 70008: 任务取消
 * - 70009: 任务已完成/不存在
 * - 70010: 渲染窗口不存在
 * - 70011: 输出目录创建失败
 * - 70012: 音频 URL 数量与曲目不匹配
 * - 70013: 无曲目
 * - 70014: 任务已存在
 * - 70015: 渲染过程未知异常
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { app, dialog, BrowserWindow } from "electron";
import { store } from "@main/store";
import { sendToMain } from "@main/utils/broadcast";
import { renderVideoLog } from "@main/utils/logger";
import {
  createVideoRendererWindow,
  getVideoRendererWindow,
} from "@main/window/videoRenderer";
import type {
  RenderVideoRequest,
  RenderVideoTask,
  RenderVideoProgress,
  RenderVideoResolution,
} from "@shared/types/renderVideo";

/** 进度推送节流间隔 */
const PROGRESS_INTERVAL_MS = 200;

/** 等待渲染窗口 ready 的超时时间 */
const READY_TIMEOUT_MS = 10000;

/**
 * 单首曲目渲染完成的超时时间
 *
 * 等于 track.duration + 30s 余量，避免任务死等。
 * 若 audio.ended 因任何原因不触发（如 AudioContext suspended），
 * 主进程会在超时后主动 reject，释放队列并清理写入流。
 */
const TRACK_RENDER_TIMEOUT_BASE_MS = 30_000;

/** 分辨率 → 实际像素 */
const RESOLUTION_MAP: Record<RenderVideoResolution, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "2160p": { width: 3840, height: 2160 },
};

/** 任务记录 */
interface TaskRecord {
  task: RenderVideoTask;
  request: RenderVideoRequest;
  writeStream?: fs.WriteStream;
  progressTimer?: NodeJS.Timeout;
  lastProgressMs: number;
  /** 进度心跳日志时间戳（节流用），避免高频刷屏 */
  lastProgressLogAt?: number;
}

/** 全部任务（含历史） */
const records = new Map<string, TaskRecord>();

/** 当前正在执行的任务 ID */
let currentTaskId: string | null = null;

/** 待执行队列（FIFO） */
const queue: string[] = [];

/** 等待 finished / error 的 resolver */
interface PendingResolve {
  resolve: () => void;
  reject: (err: Error) => void;
}
const pendings = new Map<string, PendingResolve>();

/**
 * 获取渲染输出根目录
 */
export const getRenderDir = (): string =>
  store.get("renderVideo.dir") || path.join(app.getPath("videos"), "Soto Player-Community");

/**
 * 选择输出目录
 */
export const pickDir = async (): Promise<{ ok: boolean; dir: string; reason?: "canceled" }> => {
  const result = await dialog.showOpenDialog({
    title: "选择视频输出目录",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, dir: getRenderDir(), reason: "canceled" };
  }
  const dir = result.filePaths[0];
  store.set("renderVideo.dir", dir);
  renderVideoLog.info(`[ERR-70011-B] 用户选择输出目录: ${dir}`);
  return { ok: true, dir };
};

/**
 * 设置输出目录
 */
export const setDir = (dir: string): void => {
  store.set("renderVideo.dir", dir);
  renderVideoLog.info(`[ERR-70011-C] 设置输出目录: ${dir}`);
};

/**
 * 任务列表快照
 */
export const list = (): RenderVideoTask[] => {
  return Array.from(records.values())
    .map((r) => r.task)
    .sort((a, b) => b.createdAt - a.createdAt);
};

/**
 * 推送任务状态变更
 */
const broadcastState = (task: RenderVideoTask): void => {
  sendToMain("renderVideo:state", task);
};

/**
 * 推送进度
 */
const broadcastProgress = (data: RenderVideoProgress): void => {
  sendToMain("renderVideo:progress", data);
};

/**
 * 生成唯一文件名（避免覆盖已有文件）
 */
const resolveUniquePath = (dir: string, baseName: string, ext: string): string => {
  const safe = baseName.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "render";
  const maxLen = 120;
  const trimmed = safe.length > maxLen ? safe.slice(0, maxLen) : safe;
  let candidate = path.join(dir, `${trimmed}.${ext}`);
  let i = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${trimmed} (${i}).${ext}`);
    i++;
  }
  return candidate;
};

/**
 * 启动渲染任务（入队）
 */
export const start = async (req: RenderVideoRequest): Promise<{ ok: boolean; error?: string }> => {
  renderVideoLog.info(
    `[ERR-70001-I] 启动渲染任务 taskId=${req.taskId} mode=${req.mode} tracks=${req.tracks.length}`,
  );

  if (records.has(req.taskId)) {
    renderVideoLog.warn(`[ERR-70014-A] 任务已存在 taskId=${req.taskId}`);
    return { ok: false, error: `[ERR-70014-A] Task already exists` };
  }
  if (req.tracks.length === 0) {
    renderVideoLog.warn(`[ERR-70013-A] 未提供任何曲目`);
    return { ok: false, error: `[ERR-70013-A] No tracks provided` };
  }
  if (req.audioUrls.length !== req.tracks.length) {
    renderVideoLog.warn(
      `[ERR-70012-A] 音频 URL 数量(${req.audioUrls.length})与曲目数(${req.tracks.length})不匹配`,
    );
    return { ok: false, error: `[ERR-70012-A] audioUrls length mismatch` };
  }
  // 校验/创建输出目录
  const outDir = req.outputDir || getRenderDir();
  try {
    await fsp.mkdir(outDir, { recursive: true });
    renderVideoLog.info(`[ERR-70011-A] 输出目录已就绪: ${outDir}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderVideoLog.error(`[ERR-70011-D] 输出目录创建失败: ${outDir} → ${message}`);
    return { ok: false, error: `[ERR-70011-D] Cannot create output dir: ${message}` };
  }
  req.outputDir = outDir;

  const task: RenderVideoTask = {
    taskId: req.taskId,
    status: "queued",
    mode: req.mode,
    currentIndex: 0,
    total: req.mode === "merge" ? req.tracks.length : 1,
    renderedMs: 0,
    currentDurationMs: req.tracks[0]?.duration ?? 0,
    createdAt: Date.now(),
  };
  records.set(req.taskId, { task, request: req, lastProgressMs: 0 });
  queue.push(req.taskId);
  broadcastState(task);
  renderVideoLog.info(`[ERR-70001-J] 任务已入队 taskId=${req.taskId} queueLen=${queue.length}`);

  void processQueue();
  return { ok: true };
};

/**
 * 取消任务
 */
export const cancel = async (taskId: string): Promise<void> => {
  const record = records.get(taskId);
  if (!record) {
    renderVideoLog.warn(`[ERR-70009-A] 取消失败：任务不存在 taskId=${taskId}`);
    return;
  }

  renderVideoLog.info(`[ERR-70008-A] 取消任务 taskId=${taskId} status=${record.task.status}`);

  if (taskId === currentTaskId) {
    // 通知渲染窗口停止
    const win = getVideoRendererWindow();
    if (!win) {
      renderVideoLog.warn(`[ERR-70010-B] 取消时渲染窗口不存在 taskId=${taskId}`);
    } else {
      win.webContents.send("renderVideo:cancel", { taskId });
    }
    record.task.status = "canceled";
    record.task.finishedAt = Date.now();
    broadcastState(record.task);
    await cleanupTask(taskId);
    currentTaskId = null;
    void processQueue();
  } else {
    // 在队列中：直接移除
    const idx = queue.indexOf(taskId);
    if (idx >= 0) queue.splice(idx, 1);
    record.task.status = "canceled";
    record.task.finishedAt = Date.now();
    broadcastState(record.task);
    renderVideoLog.info(`[ERR-70008-B] 队列中任务已取消 taskId=${taskId}`);
  }
};

/**
 * 处理队列中的下一个任务
 */
const processQueue = async (): Promise<void> => {
  if (currentTaskId) return;
  const nextId = queue.shift();
  if (!nextId) return;
  const record = records.get(nextId);
  if (!record) {
    renderVideoLog.warn(`[ERR-70009-B] 队列任务记录丢失 taskId=${nextId}`);
    void processQueue();
    return;
  }
  if (record.task.status === "canceled") {
    renderVideoLog.info(`[ERR-70008-C] 跳过已取消任务 taskId=${nextId}`);
    void processQueue();
    return;
  }

  currentTaskId = nextId;
  renderVideoLog.info(`[ERR-70001-K] 开始执行任务 taskId=${nextId}`);
  try {
    await runTask(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderVideoLog.error(`[ERR-70015-A] 任务执行异常 taskId=${nextId} → ${message}`);
    record.task.status = "failed";
    record.task.error = message;
    record.task.finishedAt = Date.now();
    broadcastState(record.task);
    sendToMain("renderVideo:failed", { taskId: record.task.taskId, error: message });
    await cleanupTask(nextId);
  } finally {
    currentTaskId = null;
    void processQueue();
  }
};

/** 渲染窗口是否已就绪（onConfig/onCancel 已订阅） */
let rendererReady = false;

/** 渲染窗口就绪 Promise resolver（由 handleReady 触发） */
let readyResolver: (() => void) | null = null;

/**
 * 等待渲染窗口就绪（onConfig/onCancel 已订阅）
 *
 * 比 did-finish-load 更可靠：Vue 组件 onMounted 完成后才发送 ready，
 * 保证 send config 时订阅已建立。
 *
 * 时序兼容：渲染窗口可能在 did-finish-load 之前就发送 ready（Vue 应用启动早于
 * Chromium 报告加载完成）。handleReady 会立即设置 rendererReady=true，本函数在
 * did-finish-load 等待结束后再次检查 rendererReady，避免丢失 ready 信号导致超时。
 *
 * 首次创建窗口时等待 ready；后续任务复用窗口直接返回（已就绪）。
 */
const waitForReady = async (win: BrowserWindow): Promise<void> => {
  // 已就绪（窗口复用场景，或 ready 信号在调用前已到达）
  if (rendererReady) {
    renderVideoLog.debug("[ERR-70003-A] 渲染窗口已就绪（复用/早到）");
    return;
  }
  // 若窗口尚未加载完成，等待 did-finish-load
  // 注意：等待期间 ready 信号可能提前到达（handleReady 会置位 rendererReady）
  if (win.webContents.isLoading()) {
    renderVideoLog.debug("[ERR-70003-B] 等待 did-finish-load...");
    await new Promise<void>((resolve) => {
      win.webContents.once("did-finish-load", () => resolve());
    });
    renderVideoLog.debug("[ERR-70003-C] did-finish-load 已触发");
    // did-finish-load 等待期间 ready 信号可能已到达，避免重复等待
    if (rendererReady) {
      renderVideoLog.info("[ERR-70003-J] did-finish-load 后发现 ready 信号已到达");
      return;
    }
  }
  // 等待渲染窗口 onMounted 发来的 ready 信号
  renderVideoLog.debug(`[ERR-70003-D] 等待 ready 信号（最多 ${READY_TIMEOUT_MS}ms）...`);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      readyResolver = null;
      reject(new Error(`[ERR-70003-E] Renderer window ready timeout after ${READY_TIMEOUT_MS}ms`));
    }, READY_TIMEOUT_MS);
    // ready 等待超时不阻止进程退出
    timeout.unref();
    readyResolver = () => {
      clearTimeout(timeout);
      resolve();
    };
  });
  renderVideoLog.info("[ERR-70003-F] 渲染窗口已就绪");
};

/** 渲染窗口就绪信号处理器 */
export const handleReady = (): void => {
  renderVideoLog.info("[ERR-70003-G] 收到渲染窗口 ready 信号");
  rendererReady = true;
  if (readyResolver) {
    readyResolver();
    readyResolver = null;
  }
};

/** 重置 ready 标志（窗口关闭时调用） */
export const resetReady = (): void => {
  renderVideoLog.info("[ERR-70003-H] 重置渲染窗口 ready 标志");
  rendererReady = false;
};

/**
 * 执行单个任务
 *
 * - single 模式：渲染首曲为独立文件
 * - merge 模式：按顺序渲染每曲为独立文件（文件名带序号前缀，便于按顺序播放/串接）
 *   注：真正的「合并为单个视频 + 过渡动画」需要 ffmpeg 串接，当前实现为多文件批次渲染
 */
const runTask = async (record: TaskRecord): Promise<void> => {
  const { task, request: req } = record;
  const win = createVideoRendererWindow();
  await waitForReady(win);

  // single 模式仅渲染首曲；merge 模式按顺序处理每个曲目
  const tracksToRender = req.mode === "merge" ? req.tracks : req.tracks.slice(0, 1);
  const trackTransitionStyle = req.trackTransitionStyle;

  const outputFiles: string[] = [];

  renderVideoLog.info(
    `[ERR-70001-L] 开始渲染 taskId=${task.taskId} 总数=${tracksToRender.length} 分辨率=${req.resolution} 帧率=${req.fps}`,
  );

  for (let i = 0; i < tracksToRender.length; i++) {
    task.currentIndex = i;
    const track = tracksToRender[i];
    task.status = "rendering";
    task.currentDurationMs = track.duration;
    task.renderedMs = 0;
    broadcastState(task);

    // 使用渲染层预解析好的 audioUrl（与播放/下载同源）
    const audioUrl = req.audioUrls[i];
    if (!audioUrl) {
      renderVideoLog.error(`[ERR-70004-A] 曲目无音频 URL taskId=${task.taskId} idx=${i}`);
      throw new Error(`[ERR-70004-A] Track ${track.title} has no audio URL`);
    }

    const { width, height } = RESOLUTION_MAP[req.resolution];
    const ext = req.format;
    // 文件名：merge 模式带序号前缀（01 - artist - title.ext）
    const artistName = track.artists?.[0]?.name ?? "Unknown";
    const baseName =
      req.mode === "merge" && tracksToRender.length > 1
        ? `${String(i + 1).padStart(2, "0")} - ${artistName} - ${track.title}`
        : `${artistName} - ${track.title}`;
    const filePath = resolveUniquePath(req.outputDir, baseName, ext);
    outputFiles.push(filePath);

    // 创建写入流
    let writeStream: fs.WriteStream;
    try {
      writeStream = fs.createWriteStream(filePath);
      record.writeStream = writeStream;
      renderVideoLog.info(`[ERR-70007-A] 创建输出文件: ${filePath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      renderVideoLog.error(`[ERR-70007-B] 创建输出文件失败: ${filePath} → ${message}`);
      throw new Error(`[ERR-70007-B] Cannot create output file: ${message}`);
    }

    // 监听写入错误
    writeStream.on("error", (err) => {
      renderVideoLog.error(`[ERR-70007-C] 文件写入错误: ${filePath} → ${err.message}`);
    });

    // 进度节流
    record.progressTimer = setInterval(() => {
      if (task.renderedMs !== record.lastProgressMs) {
        record.lastProgressMs = task.renderedMs;
        broadcastProgress({
          taskId: task.taskId,
          status: task.status,
          currentIndex: task.currentIndex,
          total: task.total,
          renderedMs: task.renderedMs,
          currentDurationMs: task.currentDurationMs,
        });
      }
    }, PROGRESS_INTERVAL_MS);
    // 进度轮询不阻止进程退出
    record.progressTimer.unref();

    // 下发配置到渲染窗口
    renderVideoLog.info(
      `[ERR-70001-M] 下发配置到渲染窗口 taskId=${task.taskId} idx=${i} audioUrl=${audioUrl.slice(0, 80)}...`,
    );
    win.webContents.send("renderVideo:config", {
      taskId: task.taskId,
      audioUrl,
      track,
      format: req.format,
      width,
      height,
      fps: req.fps,
      videoBitrate: req.videoBitrate,
      isContinuation: i > 0,
      trackTransitionStyle,
      outputName: path.basename(filePath, `.${ext}`),
      // 已解析的歌词行（与 tracks 一一对应）
      lyricLines: req.parsedLyrics[i] ?? [],
      // 用户设置快照（首次下发后渲染窗口会缓存）
      settingsSnapshot: req.settingsSnapshot,
      // 用户主题快照（独立 partition 无持久化值，必须下发）
      themeSnapshot: req.themeSnapshot,
    });

    // 等待当前曲目渲染完成（带超时保护，避免 audio.ended 永不触发导致死等）
    const trackDurationMs = track.duration ?? 0;
    const trackTimeoutMs = Math.max(
      TRACK_RENDER_TIMEOUT_BASE_MS,
      trackDurationMs + TRACK_RENDER_TIMEOUT_BASE_MS,
    );
    renderVideoLog.debug(
      `[ERR-70001-N] 等待曲目渲染完成 taskId=${task.taskId} idx=${i} timeout=${trackTimeoutMs}ms`,
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendings.delete(task.taskId);
        reject(
          new Error(
            `[ERR-70015-C] 渲染超时 taskId=${task.taskId} idx=${i} timeout=${trackTimeoutMs}ms`,
          ),
        );
      }, trackTimeoutMs);
      // 渲染超时兜底不阻止进程退出
      timeout.unref();
      pendings.set(task.taskId, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (err: unknown) => {
          clearTimeout(timeout);
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      });
    });
    renderVideoLog.info(`[ERR-70001-O] 曲目渲染完成 taskId=${task.taskId} idx=${i}`);

    // 关闭写入流
    await new Promise<void>((resolve) => writeStream.end(resolve));
    if (record.progressTimer) {
      clearInterval(record.progressTimer);
      record.progressTimer = undefined;
    }
  }

  // merge 模式下记录首个文件路径（用户可按序号前缀找到全部产物）
  task.filePath = outputFiles[0];
  task.status = "done";
  task.finishedAt = Date.now();
  broadcastState(task);
  sendToMain("renderVideo:finished", { taskId: task.taskId, filePath: task.filePath });
  renderVideoLog.info(
    `[ERR-70001-P] 任务全部完成 taskId=${task.taskId} 产物=${outputFiles.length} 首文件=${task.filePath}`,
  );
  await cleanupTask(task.taskId);
};

/**
 * 清理任务资源
 */
const cleanupTask = async (taskId: string): Promise<void> => {
  const record = records.get(taskId);
  if (!record) return;
  if (record.progressTimer) {
    clearInterval(record.progressTimer);
    record.progressTimer = undefined;
  }
  if (record.writeStream && !record.writeStream.destroyed) {
    await new Promise<void>((resolve) => record.writeStream!.end(resolve));
  }
  pendings.delete(taskId);
  // 保留 records 用于历史查询
};

/**
 * 接收渲染窗口发来的分片
 */
export const handleChunk = (taskId: string, data: ArrayBuffer, final: boolean): void => {
  const record = records.get(taskId);
  if (!record?.writeStream) {
    renderVideoLog.warn(
      `[ERR-70007-D] 收到分片但无写入流 taskId=${taskId} final=${final} bytes=${data.byteLength}`,
    );
    return;
  }
  // 流已关闭（finished 后 cleanup 或下一曲切换）：丢弃迟到的分片
  // 这是无害的，因为 onstop 已等待所有 pending chunks 发送完成，
  // 迟到的分片只可能是 IPC 传输过程中的残留
  if (record.writeStream.destroyed || record.writeStream.writableEnded) {
    renderVideoLog.warn(
      `[ERR-70007-Y] 收到分片但流已关闭 taskId=${taskId} final=${final} bytes=${data.byteLength}`,
    );
    return;
  }
  // 成功路径补 info 日志（采样输出，避免高频刷屏）
  renderVideoLog.info(
    `[ERR-70007-X] 收到分片 taskId=${taskId} bytes=${data.byteLength} final=${final}`,
  );
  try {
    record.writeStream.write(Buffer.from(data));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    renderVideoLog.error(`[ERR-70007-E] 写入分片失败 taskId=${taskId} → ${message}`);
  }
};

/**
 * 接收渲染窗口进度更新
 */
export const handleProgress = (taskId: string, renderedMs: number): void => {
  const record = records.get(taskId);
  if (!record) return;
  record.task.renderedMs = renderedMs;
  // 心跳日志（每 5s 打一次，便于判断 audio.currentTime 是否推进）
  const now = Date.now();
  if (!record.lastProgressLogAt || now - record.lastProgressLogAt > 5000) {
    record.lastProgressLogAt = now;
    renderVideoLog.info(
      `[ERR-70001-R] 进度心跳 taskId=${taskId} renderedMs=${renderedMs} totalMs=${record.task.currentDurationMs}`,
    );
  }
};

/**
 * 渲染窗口回报当前曲目完成
 *
 * 收到 finished 信号意味着渲染窗口已发送所有 chunk 并 flush 完毕（onstop 等待
 * Promise.all(pendingChunks) 后才发 finished）。但 IPC 传输存在乱序风险：
 * 最后一个 chunk 可能在 finished 信号之后到达。
 *
 * 为彻底消除 race condition，主进程收到 finished 后等待一个微任务延迟，
 * 确保所有 in-flight chunk 都已入 writeStream 队列后再 resolve。
 */
export const handleFinished = async (taskId: string): Promise<void> => {
  renderVideoLog.info(`[ERR-70001-Q] 渲染窗口回报完成 taskId=${taskId}`);
  // 等待所有 in-flight chunk 到达：IPC 传输虽然保证顺序，但 finished 信号可能
  // 与最后一个 chunk 同时在传输队列中。一个微任务延迟让 IPC 队列清空。
  await new Promise<void>((resolve) => setImmediate(resolve));
  const pending = pendings.get(taskId);
  if (pending) {
    pending.resolve();
    pendings.delete(taskId);
  } else {
    renderVideoLog.warn(`[ERR-70009-C] 收到完成信号但无 pending taskId=${taskId}`);
  }
};

/**
 * 渲染窗口回报错误
 */
export const handleError = (taskId: string, message: string): void => {
  renderVideoLog.error(`[ERR-70005-A] 渲染窗口回报错误 taskId=${taskId} → ${message}`);
  const pending = pendings.get(taskId);
  if (pending) {
    pending.reject(new Error(`[ERR-70005-A] ${message}`));
    pendings.delete(taskId);
  } else {
    renderVideoLog.warn(`[ERR-70009-D] 收到错误信号但无 pending taskId=${taskId}`);
  }
};

renderVideoLog.info("[renderVideoManager] 模块已加载");
