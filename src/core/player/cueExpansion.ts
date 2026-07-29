/**
 * CUE 分轨队列展开
 *
 * 当用户从曲库选中一首"原始音频文件"（非 cue:// 路径）播放时，
 * 若库中存在该音频对应的 CUE 虚拟分轨，则把选中的原始音频替换为
 * 全部分轨再装入播放队列，实现"按 CUE 分轨逐首播放"。
 *
 * 已是 cue:// 的曲目不重复展开；无 CUE 分轨的曲目保持原样。
 */
// 注：使用相对路径而非 @shared/* 别名，以便 tsx --test 直接解析
// （参考 src/components/dev/extensionInspectorHelpers.ts 的同样处理）
import type { Track } from "../../../shared/types/player";
import { isCueTrackPath, getCueAudioPath } from "../../../shared/utils/cuePath";

/**
 * 把选中曲目中的"原始音频"替换为对应的 CUE 虚拟分轨
 *
 * @param selected 用户选中的曲目（1 首或多首）
 * @param libraryTracks 当前曲库全部曲目（用于反查 CUE 分轨）
 * @returns 展开后的播放队列
 */
export const expandCueTracks = (
  selected: readonly Track[],
  libraryTracks: readonly Track[],
): Track[] => {
  // 构造 audioPath → CUE 分轨列表 的索引（仅一次）
  const cueIndex = new Map<string, Track[]>();
  for (const t of libraryTracks) {
    if (!t.path || !isCueTrackPath(t.path)) continue;
    const audioPath = getCueAudioPath(t.path);
    if (!audioPath) continue;
    const list = cueIndex.get(audioPath);
    if (list) {
      list.push(t);
    } else {
      cueIndex.set(audioPath, [t]);
    }
  }

  const result: Track[] = [];
  for (const track of selected) {
    // 已是 cue:// 分轨：原样保留
    if (track.path && isCueTrackPath(track.path)) {
      result.push(track);
      continue;
    }
    // 原始音频：查库中是否有对应 CUE 分轨
    if (track.path) {
      const cueTracks = cueIndex.get(track.path);
      if (cueTracks && cueTracks.length > 0) {
        // 按 CUE index 排序（path 末尾的 #N）
        const sorted = [...cueTracks].sort((a, b) => {
          const idxA = a.path?.lastIndexOf("#") ?? -1;
          const idxB = b.path?.lastIndexOf("#") ?? -1;
          const numA = idxA >= 0 ? Number.parseInt(a.path!.slice(idxA + 1), 10) : 0;
          const numB = idxB >= 0 ? Number.parseInt(b.path!.slice(idxB + 1), 10) : 0;
          return numA - numB;
        });
        result.push(...sorted);
        continue;
      }
    }
    // 无 CUE 分轨：原样保留
    result.push(track);
  }
  return result;
};
