import type { EqualizerBand, EqualizerCustomPreset, EqualizerPreset } from "@shared/types/settings";
import { EqualizerFilterType } from "@shared/types/settings";
import { EQ_DEFAULT_FREQS, EQ_DEFAULT_Q } from "@shared/defaults/settings";
import { useSettingsStore } from "@/stores/settings";

/**
 * 滑块拖动时 IPC 节流：前导立即发一次（保证响应），trailing 在 30ms 静默后补发最终值。
 * Rust 侧已有 20ms 参数平滑，此处节流主要用于减少 IPC 风暴造成的锁竞争。
 */
const throttleIPC = <T extends (value: number) => void>(fn: T, ms = 30): T => {
  let lastTime = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastValue = 0;
  return ((value: number) => {
    lastValue = value;
    const now = Date.now();
    const remaining = ms - (now - lastTime);
    if (remaining <= 0) {
      lastTime = now;
      fn(value);
    } else if (!timer) {
      timer = setTimeout(() => {
        lastTime = Date.now();
        timer = null;
        fn(lastValue);
      }, remaining);
    }
  }) as T;
};

const throttledSetBassGain = throttleIPC((v) => window.api.player.setBassGain(v));
const throttledSetTrebleGain = throttleIPC((v) => window.api.player.setTrebleGain(v));
const throttledSetSurroundGain = throttleIPC((v) => window.api.player.setSurroundGain(v));
const throttledSetPreampGain = throttleIPC((v) => window.api.player.setPreampGain(v));

/** 内置预设：频段增益（dB）数组，对应 EQ_DEFAULT_FREQS */
const BUILTIN_PRESET_GAINS: Record<Exclude<EqualizerPreset, "custom">, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pop: [-1, 2, 4, 5, 3, 1, -1, -1, 0, 1],
  rock: [4, 3, -2, -3, -1, 2, 4, 5, 5, 5],
  classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  electronic: [4, 3, 1, -2, -2, 1, 2, 3, 4, 5],
  bass: [6, 5, 4, 2, 0, -1, -2, -3, -3, -3],
  vocal: [-2, -1, -1, 1, 3, 3, 2, 1, 0, -1],
  dance: [4, 5, 3, 0, 1, 3, 4, 4, 3, 0],
  soft: [3, 1, 0, 2, 3, 2, 1, 2, 3, 4],
};

/** 内置预设顺序（不含 custom，custom 由 matchPreset 自动判定） */
export const BUILTIN_PRESET_ORDER: Exclude<EqualizerPreset, "custom">[] = [
  "flat",
  "pop",
  "rock",
  "classical",
  "electronic",
  "bass",
  "vocal",
  "dance",
  "soft",
];

/** 用预设增益数组构造 EqualizerBand[] */
const buildBandsFromGains = (gains: number[]): EqualizerBand[] =>
  EQ_DEFAULT_FREQS.map((freq, idx) => ({
    freq,
    q: EQ_DEFAULT_Q,
    gain: gains[idx] ?? 0,
    filterType: EqualizerFilterType.Peaking,
  }));

/** 内置预设 → 完整 band 参数 */
const BUILTIN_PRESET_BANDS: Record<
  Exclude<EqualizerPreset, "custom">,
  EqualizerBand[]
> = Object.fromEntries(
  BUILTIN_PRESET_ORDER.map((key) => [key, buildBandsFromGains(BUILTIN_PRESET_GAINS[key])]),
) as Record<Exclude<EqualizerPreset, "custom">, EqualizerBand[]>;

/** 比较两组 band 是否在数值精度内一致 */
const bandsEqual = (a: EqualizerBand[], b: EqualizerBand[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      Math.abs(a[i].freq - b[i].freq) > 0.1 ||
      Math.abs(a[i].q - b[i].q) > 0.01 ||
      Math.abs(a[i].gain - b[i].gain) > 0.01 ||
      a[i].filterType !== b[i].filterType
    ) {
      return false;
    }
  }
  return true;
};

/** 在内置预设中查找匹配项，找不到返回 "custom" */
const matchPreset = (bands: EqualizerBand[]): EqualizerPreset => {
  for (const key of BUILTIN_PRESET_ORDER) {
    if (bandsEqual(bands, BUILTIN_PRESET_BANDS[key])) return key;
  }
  return "custom";
};

/**
 * 均衡器共享状态与操作
 *
 * 把 settings.system.player.equalizer 的字段映射为本地 ref，
 * 每次变更同时：写回 settings store、下发引擎 IPC。
 * 频响曲线和电平表通过单独的 IPC 拉取，避免阻塞 UI。
 */
export const useEqualizer = () => {
  const settings = useSettingsStore();

  const eq = computed(() => settings.system.player.equalizer);

  const enabled = computed({
    get: () => eq.value?.enabled ?? false,
    set: (value: boolean) => {
      settings.setSystem("player.equalizer.enabled", value);
      void window.api.player.setEqualizerEnabled(value);
    },
  });

  const bypass = computed({
    get: () => eq.value?.bypass ?? false,
    set: (value: boolean) => {
      settings.setSystem("player.equalizer.bypass", value);
      void window.api.player.setEqualizerBypass(value);
    },
  });

  const bands = computed<EqualizerBand[]>(() => eq.value?.bands ?? []);
  const preamp = computed(() => eq.value?.preamp ?? 0);
  const bassBoost = computed(() => eq.value?.bassBoost ?? 0);
  const trebleBoost = computed(() => eq.value?.trebleBoost ?? 0);
  const surround = computed(() => eq.value?.surround ?? 1.0);
  const customPresets = computed<EqualizerCustomPreset[]>(() => eq.value?.customPresets ?? []);

  /** 当前匹配到的预设名（含 custom） */
  const currentPreset = computed<EqualizerPreset>(() => eq.value?.preset ?? "flat");

  /** 全部可选预设（内置 + 自定义 + custom 占位） */
  const presetOptions = computed(() => {
    const builtin = BUILTIN_PRESET_ORDER.map((key) => ({
      value: key as EqualizerPreset,
      label: key,
      isCustom: false,
    }));
    const custom = customPresets.value.map((p) => ({
      value: `custom:${p.id}` as EqualizerPreset,
      label: p.name,
      isCustom: true,
      presetId: p.id,
    }));
    return [
      ...builtin,
      ...custom,
      { value: "custom" as EqualizerPreset, label: "custom", isCustom: false },
    ];
  });

  /**
   * 应用内置预设：替换全部 band 参数并下发引擎
   */
  const applyBuiltinPreset = (key: Exclude<EqualizerPreset, "custom">): void => {
    const newBands = BUILTIN_PRESET_BANDS[key].map((b) => ({ ...b }));
    settings.setSystem("player.equalizer.bands", newBands);
    settings.setSystem("player.equalizer.preset", key);
    void syncBandsToEngine(newBands);
  };

  /**
   * 应用自定义预设：替换 band + preamp + bass + treble + surround
   */
  const applyCustomPreset = (preset: EqualizerCustomPreset): void => {
    const newBands = preset.bands.map((b) => ({ ...b }));
    settings.setSystem("player.equalizer.bands", newBands);
    settings.setSystem("player.equalizer.preamp", preset.preamp);
    settings.setSystem("player.equalizer.bassBoost", preset.bassBoost);
    settings.setSystem("player.equalizer.trebleBoost", preset.trebleBoost);
    settings.setSystem("player.equalizer.surround", preset.surround);
    settings.setSystem("player.equalizer.preset", `custom:${preset.id}` as EqualizerPreset);
    void syncAllToEngine(newBands, preset);
  };

  /** 通过 preset value（下拉选项）应用预设 */
  const applyPreset = (value: EqualizerPreset): void => {
    if (value === "custom") return;
    if (value.startsWith("custom:")) {
      const id = value.slice("custom:".length);
      const target = customPresets.value.find((p) => p.id === id);
      if (target) applyCustomPreset(target);
      return;
    }
    applyBuiltinPreset(value as Exclude<EqualizerPreset, "custom">);
  };

  /**
   * 更新指定频段参数
   * 仅写本地 + 该频段的 IPC，避免全量下发
   */
  const updateBand = (index: number, params: Partial<EqualizerBand>): void => {
    const current = bands.value;
    if (index < 0 || index >= current.length) return;
    const merged: EqualizerBand = { ...current[index], ...params };
    const next = [...current];
    next[index] = merged;
    settings.setSystem("player.equalizer.bands", next);
    settings.setSystem("player.equalizer.preset", matchPreset(next));
    void window.api.player.setEqualizerBandParams(index, merged);
  };

  /** 增加一个频段（默认 1000Hz / Q=1.4 / 0dB / Peaking） */
  const addBand = (): void => {
    const next = [
      ...bands.value,
      {
        freq: 1000,
        q: EQ_DEFAULT_Q,
        gain: 0,
        filterType: EqualizerFilterType.Peaking,
      },
    ];
    settings.setSystem("player.equalizer.bands", next);
    settings.setSystem("player.equalizer.preset", matchPreset(next));
    void window.api.player.setEqualizerBandCount(next.length);
    void window.api.player.setEqualizerBandParams(next.length - 1, next[next.length - 1]);
  };

  /** 删除指定频段 */
  const removeBand = (index: number): void => {
    const current = bands.value;
    if (current.length <= 1) return;
    const next = current.filter((_, i) => i !== index);
    settings.setSystem("player.equalizer.bands", next);
    settings.setSystem("player.equalizer.preset", matchPreset(next));
    void syncBandsToEngine(next);
  };

  /** 设置前级增益 */
  const setPreamp = (value: number): void => {
    settings.setSystem("player.equalizer.preamp", value);
    void throttledSetPreampGain(value);
  };

  /** 设置低音增益 */
  const setBassBoost = (value: number): void => {
    settings.setSystem("player.equalizer.bassBoost", value);
    void throttledSetBassGain(value);
  };

  /** 设置高音增益 */
  const setTrebleBoost = (value: number): void => {
    settings.setSystem("player.equalizer.trebleBoost", value);
    void throttledSetTrebleGain(value);
  };

  /** 设置环绕声增益 */
  const setSurround = (value: number): void => {
    settings.setSystem("player.equalizer.surround", value);
    void throttledSetSurroundGain(value);
  };

  /** 重置为 flat 预设 + 清零所有增益 */
  const resetAll = (): void => {
    applyBuiltinPreset("flat");
    setPreamp(0);
    setBassBoost(0);
    setTrebleBoost(0);
    setSurround(1.0);
  };

  /**
   * 保存当前设置为自定义预设
   * @param name 预设名称
   * @returns 新预设的 id
   */
  const saveCustomPreset = (name: string): string => {
    const id = crypto.randomUUID();
    const preset: EqualizerCustomPreset = {
      id,
      name,
      bands: bands.value.map((b) => ({ ...b })),
      preamp: preamp.value,
      bassBoost: bassBoost.value,
      trebleBoost: trebleBoost.value,
      surround: surround.value,
    };
    const next = [...customPresets.value, preset];
    settings.setSystem("player.equalizer.customPresets", next);
    settings.setSystem("player.equalizer.preset", `custom:${id}` as EqualizerPreset);
    return id;
  };

  /** 删除自定义预设 */
  const deleteCustomPreset = (id: string): void => {
    const next = customPresets.value.filter((p) => p.id !== id);
    settings.setSystem("player.equalizer.customPresets", next);
    if (currentPreset.value === `custom:${id}`) {
      settings.setSystem("player.equalizer.preset", "custom");
    }
  };

  /** 重命名自定义预设 */
  const renameCustomPreset = (id: string, name: string): void => {
    const next = customPresets.value.map((p) => (p.id === id ? { ...p, name } : p));
    settings.setSystem("player.equalizer.customPresets", next);
  };

  /** 同步全部 band 参数到引擎（用于预设切换、增删频段） */
  const syncBandsToEngine = async (newBands: EqualizerBand[]): Promise<void> => {
    await window.api.player.setEqualizerBandCount(newBands.length);
    for (const [idx, band] of newBands.entries()) {
      await window.api.player.setEqualizerBandParams(idx, band);
    }
  };

  /** 同步全部参数到引擎（自定义预设切换时） */
  const syncAllToEngine = async (
    newBands: EqualizerBand[],
    preset: EqualizerCustomPreset,
  ): Promise<void> => {
    await syncBandsToEngine(newBands);
    await window.api.player.setPreampGain(preset.preamp);
    await window.api.player.setBassGain(preset.bassBoost);
    await window.api.player.setTrebleGain(preset.trebleBoost);
    await window.api.player.setSurroundGain(preset.surround);
  };

  /** 取频响曲线（dB 数组，对应传入的频率数组） */
  const fetchFrequencyResponse = async (freqs: number[]): Promise<number[]> => {
    const result = await window.api.player.getEqualizerFrequencyResponse(freqs);
    return result.success && result.data ? result.data : freqs.map(() => 0);
  };

  /** 取输入/输出电平 RMS（左/右声道，0~1 线性） */
  const fetchLevels = async (): Promise<{
    input: [number, number];
    output: [number, number];
  }> => {
    const [input, output] = await Promise.all([
      window.api.player.getEqualizerInputLevels(),
      window.api.player.getEqualizerOutputLevels(),
    ]);
    return {
      input: input.success && input.data ? input.data : [0, 0],
      output: output.success && output.data ? output.data : [0, 0],
    };
  };

  return {
    // 状态
    enabled,
    bypass,
    bands,
    preamp,
    bassBoost,
    trebleBoost,
    surround,
    customPresets,
    currentPreset,
    presetOptions,
    // 操作
    applyPreset,
    applyBuiltinPreset,
    applyCustomPreset,
    updateBand,
    addBand,
    removeBand,
    setPreamp,
    setBassBoost,
    setTrebleBoost,
    setSurround,
    resetAll,
    saveCustomPreset,
    deleteCustomPreset,
    renameCustomPreset,
    // 引擎查询
    fetchFrequencyResponse,
    fetchLevels,
  };
};
