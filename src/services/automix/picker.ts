/**
 * Automix 选曲策略
 *
 * 在候选池中根据 BPM / 调式 / 策略打分，挑出下一首。
 * 不直接修改队列，由 manager 决定如何插入。
 */

import type { Track } from "@shared/types/player";
import type { AudioAnalysisResult } from "@shared/types/audioAnalysis";
import type {
  AutomixKeyMatchMode,
  AutomixPickStrategy,
  AutomixSettings,
} from "@shared/types/settings";
import { camelotDistance, parseKey } from "./camelot";
import { ensureAnalysis, trackKey } from "./analyzer";

/** 选曲结果 */
export interface PickResult {
  /** 选中的曲目 */
  track: Track;
  /** 在候选池中的索引（原始数组下标） */
  index: number;
  /** 综合得分（越低越优） */
  score: number;
  /** 命中原因（UI 展示） */
  reason: string;
}

/**
 * BPM 距离（带倍频/半频兼容）
 * - DJ 常用技巧：BPM ×2 或 ÷2 仍可对齐
 * @returns 归一化距离；0=完全相同
 */
export const bpmDistance = (a: number, b: number): number => {
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  const candidates = [b, b * 2, b / 2];
  let best = Number.MAX_SAFE_INTEGER;
  for (const target of candidates) {
    const diff = Math.abs(a - target);
    if (diff < best) best = diff;
  }
  return best;
};

/**
 * 调式距离（按匹配模式加权）
 * - off: 不考虑，返回 0
 * - camelot: 用 Camelot 距离
 * - strict: 必须同编号同字母，否则 +∞
 */
export const keyDistance = (
  a: AudioAnalysisResult | null,
  b: AudioAnalysisResult | null,
  mode: AutomixKeyMatchMode,
): number => {
  if (mode === "off") return 0;
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  const ka = parseKey(a.key);
  const kb = parseKey(b.key);
  if (!ka || !kb) return Number.MAX_SAFE_INTEGER;
  const dist = camelotDistance(ka, kb);
  if (mode === "strict") return dist === 0 ? 0 : Number.MAX_SAFE_INTEGER;
  return dist;
};

/**
 * 计算单首候选曲相对当前曲的综合得分
 * - 越低越优
 * - BPM 距离 ×1.0；调式距离 ×2.0（调式不匹配更刺耳）
 */
export const scoreCandidate = (
  current: AudioAnalysisResult | null,
  candidate: AudioAnalysisResult | null,
  settings: Pick<AutomixSettings, "bpmTolerance" | "keyMatchMode" | "strategy">,
): { score: number; bpmDist: number; keyDist: number } => {
  const bpmDist = bpmDistance(current?.bpm ?? 0, candidate?.bpm ?? 0);
  const keyDist = keyDistance(current, candidate, settings.keyMatchMode);

  // 策略筛选：不满足硬性条件直接淘汰
  if (settings.strategy === "bpm" || settings.strategy === "bpmKey") {
    if (settings.bpmTolerance > 0 && bpmDist > settings.bpmTolerance) {
      return { score: Number.MAX_SAFE_INTEGER, bpmDist, keyDist };
    }
  }
  if (settings.strategy === "key" || settings.strategy === "bpmKey") {
    if (settings.keyMatchMode !== "off" && keyDist > 2) {
      return { score: Number.MAX_SAFE_INTEGER, bpmDist, keyDist };
    }
  }

  const bpmWeight = settings.strategy === "key" ? 0.3 : 1.0;
  const keyWeight = settings.strategy === "bpm" ? 0.3 : 2.0;
  const score = bpmDist * bpmWeight + keyDist * keyWeight;
  return { score, bpmDist, keyDist };
};

/** 描述选曲理由 */
const describeReason = (
  candidate: AudioAnalysisResult | null,
  bpmDist: number,
  keyDist: number,
  strategy: AutomixPickStrategy,
): string => {
  if (!candidate) return "无分析数据，回退选择";
  const bpmStr = candidate.bpm > 0 ? `${candidate.bpm.toFixed(0)} BPM` : "BPM 未知";
  const keyStr = candidate.key || "调式未知";
  const delta = bpmDist < Number.MAX_SAFE_INTEGER ? `Δ${bpmDist.toFixed(0)}` : "Δ∞";
  const keyDelta = keyDist < Number.MAX_SAFE_INTEGER ? `调式距离 ${keyDist}` : "调式不匹配";
  if (strategy === "random") return `随机选择 · ${bpmStr}`;
  return `${bpmStr} · ${keyStr} · ${delta} · ${keyDelta}`;
};

/**
 * 从候选池中选下一首
 * @param current - 当前曲目（已分析）
 * @param pool - 候选池
 * @param settings - Automix 设置
 * @returns 选曲结果；池为空或全部不达标时返回 null
 */
export const pickNext = async (
  current: Track | null,
  currentAnalysis: AudioAnalysisResult | null,
  pool: Track[],
  settings: AutomixSettings,
): Promise<PickResult | null> => {
  if (pool.length === 0) return null;

  // 随机策略：直接抽一个，跳过分析
  if (settings.strategy === "random") {
    const idx = Math.floor(Math.random() * pool.length);
    const track = pool[idx];
    const analysis = settings.autoAnalyze ? await ensureAnalysis(track).catch(() => null) : null;
    return {
      track,
      index: idx,
      score: 0,
      reason: describeReason(analysis, 0, 0, "random"),
    };
  }

  // 其它策略：分析候选池后逐个打分
  const scored: Array<{
    idx: number;
    score: number;
    bpmDist: number;
    keyDist: number;
    analysis: AudioAnalysisResult | null;
  }> = [];
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[i];
    if (!candidate) continue;
    // 排除与当前曲相同 id（避免自循环）
    if (current && trackKey(current) === trackKey(candidate)) continue;
    const analysis = settings.autoAnalyze
      ? await ensureAnalysis(candidate).catch(() => null)
      : null;
    const { score, bpmDist, keyDist } = scoreCandidate(currentAnalysis, analysis, settings);
    // 已经淘汰的直接跳过
    if (score >= Number.MAX_SAFE_INTEGER) continue;
    scored.push({ idx: i, score, bpmDist, keyDist, analysis });
  }

  if (scored.length === 0) {
    // 全部不达标：回退到第一首
    const idx = 0;
    const track = pool[idx];
    if (!track) return null;
    return {
      track,
      index: idx,
      score: Number.MAX_SAFE_INTEGER,
      reason: "无匹配候选，回退第一首",
    };
  }

  scored.sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best) return null;
  const track = pool[best.idx];
  if (!track) return null;
  return {
    track,
    index: best.idx,
    score: best.score,
    reason: describeReason(best.analysis, best.bpmDist, best.keyDist, settings.strategy),
  };
};
