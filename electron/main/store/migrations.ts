import type { EqualizerBand, SystemConfig } from "@shared/types/settings";
import { EqualizerFilterType } from "@shared/types/settings";
import { EQ_DEFAULT_FREQS, EQ_DEFAULT_Q } from "@shared/defaults/settings";

export interface Migration {
  /** 版本号，递增整数 */
  version: number;
  /** 迁移函数，直接修改 data 对象 */
  migrate: (data: SystemConfig) => void;
}

/** 旧版 10 频段中心频率（与 EQ_DEFAULT_FREQS 同步，迁移专用） */
const LEGACY_FREQS = EQ_DEFAULT_FREQS;

/**
 * 把旧版 `bands: number[]`（纯增益数组）转换为参数化结构
 * 旧版长度不足/超过 10 时按位置映射，缺失频率用 1000Hz 兜底
 */
const migrateLegacyBands = (bands: unknown): EqualizerBand[] => {
  if (!Array.isArray(bands)) return [];
  return bands.map((gain, idx) => {
    const gainNum = typeof gain === "number" && Number.isFinite(gain) ? gain : 0;
    return {
      freq: LEGACY_FREQS[idx] ?? 1000,
      q: EQ_DEFAULT_Q,
      gain: gainNum,
      filterType: EqualizerFilterType.Peaking,
    };
  });
};

/**
 * 迁移列表，按 version 递增排列
 * 新增字段已由 deepMerge 自动补全，此处仅用于字段重命名、数据转换等
 */
export const migrations: Migration[] = [
  {
    version: 1,
    migrate: (data) => {
      const eq = data.player?.equalizer;
      if (!eq) return;
      // 旧版 bands 是 number[]（纯增益），新版是 EqualizerBand[]
      // 通过首元素类型判定：number → 旧版，object → 新版
      const firstBand = (eq.bands as unknown[])[0];
      if (typeof firstBand === "number") {
        eq.bands = migrateLegacyBands(eq.bands as unknown);
      }
      // 新增字段兜底
      if (typeof eq.bypass !== "boolean") eq.bypass = false;
      if (!Array.isArray(eq.customPresets)) eq.customPresets = [];
    },
  },
  {
    version: 2,
    migrate: (data) => {
      // 一起听侧栏入口默认开启：旧版本 enabled 默认 false，老用户 settings.json 持久化了 false，
      // deepMerge 让存档覆盖默认值，导致侧栏入口永不显示。这里一次性回退到 true，
      // 之后仍尊重用户手动关闭的选择
      if (typeof data.listenTogether === "object" && data.listenTogether !== null) {
        data.listenTogether.enabled = true;
      }
    },
  },
];
