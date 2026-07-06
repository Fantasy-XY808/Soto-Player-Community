/**
 * Automix 子系统入口
 *
 * 对外暴露：
 * - manager: startAutomix / stopAutomix / syncAutomixEnabled / previewPick / prefetchQueue
 * - analyzer: ensureAnalysis / prefetchAnalysis / clearAnalysisCache / getCacheSnapshot
 * - picker: pickNext / scoreCandidate / bpmDistance / keyDistance
 * - camelot: parseKey / camelotDistance / toCamelotString
 * - 状态：isActive / lastPick / queueSize
 */

export {
  startAutomix,
  stopAutomix,
  syncAutomixEnabled,
  previewPick,
  prefetchQueue,
  isActive,
  lastPick,
  queueSize,
} from "./manager";

export {
  ensureAnalysis,
  prefetchAnalysis,
  clearAnalysisCache,
  getCacheSnapshot,
  trackKey,
  trackSource,
  type CacheEntry,
} from "./analyzer";

export { pickNext, scoreCandidate, bpmDistance, keyDistance, type PickResult } from "./picker";

export {
  parseKey,
  camelotDistance,
  toCamelotString,
  type ParsedKey,
  type KeyMode,
} from "./camelot";
