/**
 * AutomixManager — 自动混音调度核心
 *
 * 职责：
 * - 监听播放进度，临近末尾时挑选下一首并插入队列
 * - 触发 crossfade（渐入渐出）或直接切换
 * - 协调 audioAnalysis 异步预分析，避免切歌瞬间卡顿
 * - 自动跳过已分析过但无可分析源的在线曲目
 *
 * 设计原则：
 * - 所有状态以模块级变量持有，避免 Vue 响应式开销
 * - watch/status 仅作为触发源，决策逻辑同步执行
 * - 隐藏窗口不工作（"Hidden = silent"），可见时从下一帧恢复
 */

import { computed, watch } from "vue";
import type { Track } from "@shared/types/player";
import type { AudioAnalysisResult } from "@shared/types/audioAnalysis";
import type { AutomixSettings } from "@shared/types/settings";
import { useSettingsStore } from "@/stores/settings";
import { useStatusStore } from "@/stores/status";
import { queue, queueLength } from "@/stores/queue";
import * as player from "@/core/player";
import { ensureAnalysis, trackKey } from "./analyzer";
import { pickNext, type PickResult } from "./picker";

/** 触发 crossfade 提前量的下限（ms），避免极短歌瞬间触发 */
const MIN_TRIGGER_MS = 500;
/** 已经触发过本曲后，再次触发的最小间隔（ms），防抖 */
const RE_TRIGGER_GUARD_MS = 1500;

/** 模块级状态 */
const state = {
  /** 是否已启动（设置 enabled=true 且首次激活后置 true） */
  active: false,
  /** 上次触发时间戳，用于防抖 */
  lastTriggerTs: 0,
  /** 当前曲的分析结果缓存（切歌时重置） */
  currentAnalysis: null as AudioAnalysisResult | null,
  /** 当前曲的 trackKey（用于检测切歌） */
  currentKey: null as string | null,
  /** 上次选曲结果（UI 展示用） */
  lastPick: null as PickResult | null,
  /** 预取中的取消标记 */
  prefetchToken: 0,
  /** 切歌请求 token：每次新触发或手动切歌自增，in-flight 检测到不一致即放弃 */
  requestToken: 0,
};

/** 是否已启动（只读响应式） */
export const isActive = computed(() => state.active);

/** 最近一次选曲结果（UI 展示用） */
export const lastPick = computed(() => state.lastPick);

/**
 * 取当前 Automix 设置（响应式）
 * - 未启用时返回 null，调用方应直接跳过
 */
const getSettings = (): AutomixSettings | null => {
  const settings = useSettingsStore();
  const cfg = settings.system.automix;
  if (!cfg || !cfg.enabled) return null;
  return cfg;
};

/**
 * 取候选池：队列中当前位置之后 N 首
 * - 不包含当前曲
 * - 在线曲（无 path）也会进入池子，picker 会自动跳过未分析的
 */
const buildPool = (currentIdx: number, poolSize: number): Track[] => {
  const list = queue.value;
  if (!list || list.length === 0) return [];
  const start = currentIdx + 1;
  if (start >= list.length) return [];
  return list.slice(start, start + poolSize);
};

/** dB 转增益倍数（gain = 10^(dB/20)） */
const dbToGain = (db: number): number => Math.pow(10, db / 20);

/** 限幅到 [0, 1] */
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/**
 * 计算 LUFS 响度匹配增益
 * - 任一 lufs 缺失 / 静音（-70）/ 0 时跳过（数据不可信）
 * - 限 ±9dB 避免极端值（next 静音时把当前曲轰成震耳欲聋）
 * @returns 增益 dB；无需匹配时返回 null
 */
const computeLufsGain = (
  currentLufs: number | undefined,
  nextLufs: number | undefined,
): number | null => {
  if (currentLufs == null || nextLufs == null) return null;
  if (currentLufs <= -70 || nextLufs <= -70) return null;
  if (currentLufs === 0 || nextLufs === 0) return null;
  const db = currentLufs - nextLufs;
  return Math.max(-9, Math.min(9, db));
};

/**
 * 触发 crossfade 切到下一首
 * - crossfadeEnabled=true：等功率 fade-out → 切歌 → fade-in（含 LUFS 匹配）→ 2s ramp 回原音量
 * - crossfadeEnabled=false：直接切，仍应用 LUFS 匹配并 ramp 回
 * - 全程 token 防竞态：手动切歌或新触发使旧 in-flight 失效
 */
const triggerTransition = async (settings: AutomixSettings): Promise<void> => {
  const status = useStatusStore();
  const currentTrack = status.currentTrack;
  if (!currentTrack) return;

  // 自增 token：使之前的 in-flight 失效
  const token = ++state.requestToken;
  // 视觉反馈：通知 UI 切歌开始
  status.automixFxSeq++;

  const pool = buildPool(status.playIndex, settings.candidatePoolSize);
  if (pool.length === 0) return;

  const pick = await pickNext(currentTrack, state.currentAnalysis, pool, settings);
  if (token !== state.requestToken) return;
  if (!pick) return;

  state.lastPick = pick;

  // 取下一首分析结果用于 LUFS 匹配（pickNext 内已 ensureAnalysis，缓存命中零延迟）
  const nextAnalysis = await ensureAnalysis(pick.track).catch(() => null);
  if (token !== state.requestToken) return;

  // LUFS 响度匹配增益：currentLufs - nextLufs
  const gainDb = computeLufsGain(state.currentAnalysis?.lufs, nextAnalysis?.lufs);

  // 插入到当前曲后一位：nextTrack 会自然播到它
  player.insertToQueue(pick.track, status.playIndex + 1);

  // 用户原始音量（ramp 回目标）
  const userVol = status.volume;

  if (settings.crossfadeEnabled && settings.crossfadeMs >= MIN_TRIGGER_MS) {
    // 等功率 fade-out：cos 曲线 1→0
    await fadeVolumeTo(0, Math.min(800, settings.crossfadeMs / 2), "out");
    if (token !== state.requestToken) return;
    await player.nextTrack(true);
    if (token !== state.requestToken) return;
    // fade-in：sin 曲线 0→target；target 已叠加 LUFS 增益
    const targetVol = gainDb !== null ? clamp01(userVol * dbToGain(gainDb)) : userVol;
    await fadeVolumeTo(targetVol, Math.min(800, settings.crossfadeMs / 2), "in");
    if (token !== state.requestToken) return;
    // 2s 内线性 ramp 回用户音量
    if (gainDb !== null && Math.abs(targetVol - userVol) > 0.005) {
      await rampVolumeTo(userVol, 2000);
    }
  } else {
    await player.nextTrack(true);
    if (token !== state.requestToken) return;
    // 直接切也应用 LUFS 增益并 ramp 回
    if (gainDb !== null) {
      const targetVol = clamp01(userVol * dbToGain(gainDb));
      await player.setVolume(targetVol);
      if (token !== state.requestToken) return;
      await rampVolumeTo(userVol, 2000);
    }
  }
  // 视觉反馈：通知 UI 切歌结束（仅当未被新请求覆盖时）
  if (token === state.requestToken) {
    status.automixEndedSeq++;
  }
};

/**
 * 等功率音量渐变
 * - fade-out: cos(t·π/2)，从 start 衰减到 target（target 通常为 0）
 * - fade-in: sin(t·π/2)，从 start 增长到 target（start 通常为 0）
 * - 等功率曲线在两段叠播时总功率恒定；此处非重叠场景下感知衰减也比线性更平滑
 * @param target - 目标音量（0-1）
 * @param durationMs - 渐变时长
 * @param direction - "out" 衰减 / "in" 增长
 */
const fadeVolumeTo = async (
  target: number,
  durationMs: number,
  direction: "in" | "out",
): Promise<void> => {
  const status = useStatusStore();
  const start = status.volume;
  if (Math.abs(start - target) < 0.01) return;
  const steps = Math.max(4, Math.floor(durationMs / 50));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // out: shaped 从 1→0（cos）；in: shaped 从 1→0（1-sin），等效于 start 占比递减
    const shaped = direction === "out" ? Math.cos(t * Math.PI * 0.5) : 1 - Math.sin(t * Math.PI * 0.5);
    const v = start * shaped + target * (1 - shaped);
    await player.setVolume(clamp01(v));
    await sleep(durationMs / steps);
  }
};

/**
 * 线性音量 ramp（LUFS 增益恢复用，2s 内拉回用户音量）
 * @param target - 目标音量
 * @param durationMs - 渐变时长
 */
const rampVolumeTo = async (target: number, durationMs: number): Promise<void> => {
  const status = useStatusStore();
  const start = status.volume;
  if (Math.abs(start - target) < 0.005) return;
  const steps = Math.max(4, Math.floor(durationMs / 50));
  const stepDelta = (target - start) / steps;
  for (let i = 1; i <= steps; i++) {
    await player.setVolume(clamp01(start + stepDelta * i));
    await sleep(durationMs / steps);
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * 检测当前曲变化，刷新 analysis 缓存
 * - 手动切歌时使 requestToken++ 让 in-flight 切歌流程失效
 * - 同时预取下一首候选的分析结果（取池子第 1 名），利用 LRU 缓存零延迟切歌
 */
const refreshCurrentAnalysis = async (): Promise<void> => {
  const status = useStatusStore();
  const track = status.currentTrack;
  if (!track) {
    state.currentAnalysis = null;
    state.currentKey = null;
    return;
  }
  const key = trackKey(track);
  if (key === state.currentKey) return;
  // 手动切歌：使 triggerTransition 中 in-flight 的旧请求失效
  state.requestToken++;
  state.currentKey = key;
  state.currentAnalysis = await ensureAnalysis(track).catch(() => null);
  // 预取下一首候选分析结果，切歌时缓存命中零延迟触发
  const settings = getSettings();
  if (settings?.autoAnalyze) {
    const pool = buildPool(status.playIndex, settings.candidatePoolSize);
    if (pool.length > 0) {
      void ensureAnalysis(pool[0]).catch(() => null);
    }
  }
};

/**
 * 评估是否应触发 crossfade
 * - 仅在主窗口可见时工作（"Hidden = silent"）
 * - 距离歌曲末尾小于 crossfadeMs 时触发
 */
const evaluate = async (): Promise<void> => {
  if (document.visibilityState === "hidden") return;
  const settings = getSettings();
  if (!settings) return;
  if (!state.active) return;

  const status = useStatusStore();
  if (status.state !== "playing") return;
  const dur = status.duration;
  const pos = status.position;
  if (dur <= 0 || pos <= 0) return;

  const remain = dur - pos;
  if (remain > settings.crossfadeMs) return;

  // 防抖：RE_TRIGGER_GUARD_MS 内不重复触发
  const now = Date.now();
  if (now - state.lastTriggerTs < RE_TRIGGER_GUARD_MS) return;
  state.lastTriggerTs = now;

  await triggerTransition(settings);
};

/** 监听器句柄（用于 dispose） */
let stopPositionWatch: (() => void) | null = null;
let stopTrackWatch: (() => void) | null = null;

/**
 * 启动 Automix 调度
 * - 注册 position / currentTrack 监听
 * - 重复调用安全（已启动时直接返回）
 */
export const startAutomix = (): void => {
  if (state.active) return;
  state.active = true;

  const status = useStatusStore();

  // position 变化时评估是否触发
  stopPositionWatch = watch(
    () => status.position,
    () => {
      void evaluate();
    },
  );

  // 当前曲变化时刷新 analysis
  stopTrackWatch = watch(
    () => status.currentTrack,
    () => {
      void refreshCurrentAnalysis();
    },
    { immediate: true },
  );
};

/**
 * 停止 Automix 调度
 * - 注销监听，但保留 lastPick 用于 UI 复显
 */
export const stopAutomix = (): void => {
  state.active = false;
  stopPositionWatch?.();
  stopTrackWatch?.();
  stopPositionWatch = null;
  stopTrackWatch = null;
};

/**
 * 同步 enabled 状态：enabled=true 启动，false 停止
 * - 由 settings watcher 调用
 */
export const syncAutomixEnabled = (enabled: boolean): void => {
  if (enabled) startAutomix();
  else stopAutomix();
};

/**
 * 手动触发一次选曲（不切歌，仅预览）
 * - UI 「试挑下一首」按钮用
 */
export const previewPick = async (): Promise<PickResult | null> => {
  const settings = getSettings();
  if (!settings) return null;
  const status = useStatusStore();
  const currentTrack = status.currentTrack;
  await refreshCurrentAnalysis();
  const pool = buildPool(status.playIndex, settings.candidatePoolSize);
  if (pool.length === 0) return null;
  const pick = await pickNext(currentTrack, state.currentAnalysis, pool, settings);
  state.lastPick = pick;
  return pick;
};

/**
 * 预分析整个队列（设置页 / 进入 Automix 模式时调）
 * - 不阻塞 UI，串行调用 IPC
 * @param onProgress - 进度回调
 */
export const prefetchQueue = async (
  onProgress?: (done: number, total: number) => void,
): Promise<void> => {
  const settings = getSettings();
  if (!settings || !settings.autoAnalyze) return;
  const list = queue.value;
  if (!list || list.length === 0) return;
  const total = list.length;
  let done = 0;
  state.prefetchToken++;
  const token = state.prefetchToken;
  for (const track of list) {
    if (state.prefetchToken !== token) return; // 被新的预取任务取消
    await ensureAnalysis(track).catch(() => null);
    done++;
    onProgress?.(done, total);
  }
};

/** 取队列长度（响应式，UI 用） */
export const queueSize = computed(() => queueLength.value);
