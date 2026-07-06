/** 音频分析结果（与 native/audio-engine 的 JsAudioAnalysis 对齐） */
export interface AudioAnalysisResult {
  /** 节拍速度（BPM），未检测到为 0 */
  bpm: number;
  /** 音乐调式（如 "C major"、"A minor"），未检测到为空串 */
  key: string;
  /** 整合响度（LUFS），静音为 -70 */
  lufs: number;
  /** 是否含人声 */
  hasVocals: boolean;
  /** 人声占比（0.0 ~ 1.0） */
  vocalRatio: number;
}

/** 分析单首曲目的 IPC 返回 */
export type AnalyzeResult =
  | { success: true; data: AudioAnalysisResult }
  | { success: false; error: string };

/** 批量分析的 IPC 返回（key = source 路径） */
export type AnalyzeBatchResult =
  | { success: true; data: Record<string, AudioAnalysisResult | null> }
  | { success: false; error: string };

/** 音频分析相关 IPC */
export interface AudioAnalysisApi {
  /** 分析整曲音频特征 */
  analyze: (source: string) => Promise<AnalyzeResult>;
  /** 批量分析多首曲目（顺序执行避免内存占用） */
  analyzeBatch: (sources: string[]) => Promise<AnalyzeBatchResult>;
}
