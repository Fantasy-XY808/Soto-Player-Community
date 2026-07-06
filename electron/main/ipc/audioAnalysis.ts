import { ipcMain } from "electron";
import { analysisLog } from "@main/utils/logger";
import { getEngine } from "@main/services/engine";
import type { AudioAnalysisResult } from "@shared/types/audioAnalysis";

/** 注册音频分析相关 IPC */
export const registerAudioAnalysisIpc = (): void => {
  // 分析整曲音频特征（BPM / 调式 / LUFS / 人声）
  // 在 Rust 端 spawn_blocking 执行，避免阻塞主进程
  ipcMain.handle("audioAnalysis:analyze", async (_event, source: string) => {
    try {
      const result = await getEngine().analyzeAudioFile(source);
      analysisLog.info(
        `分析完成 [${source}]: BPM=${result.bpm.toFixed(1)}, key=${result.key}, LUFS=${result.lufs.toFixed(1)}, vocals=${result.hasVocals}`,
      );
      return { success: true, data: result };
    } catch (err) {
      analysisLog.error(`分析失败 [${source}]:`, err);
      return { success: false, error: String(err) };
    }
  });

  // 批量分析多首曲目（用于 Automix 预扫描 / 库批量分析）
  // 顺序执行避免同时解码多个文件占用内存
  ipcMain.handle("audioAnalysis:analyzeBatch", async (_event, sources: string[]) => {
    const results: Record<string, AudioAnalysisResult | null> = {};
    for (const source of sources) {
      try {
        const result = await getEngine().analyzeAudioFile(source);
        results[source] = result;
      } catch (err) {
        analysisLog.warn(`批量分析中单项失败 [${source}]:`, err);
        results[source] = null;
      }
    }
    return { success: true, data: results };
  });
};
