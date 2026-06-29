<script setup lang="ts">
import type { EqualizerBand, EqualizerPreset } from "@shared/types/settings";
import { EqualizerFilterType } from "@shared/types/settings";
import { useEqualizer } from "@/composables/useEqualizer";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const eq = useEqualizer();

/** 频响曲线画布元素 */
const canvasRef = ref<HTMLCanvasElement | null>(null);
/** 画布容器，用于 ResizeObserver 监听宽度 */
const canvasWrapRef = ref<HTMLElement | null>(null);
/** 画布逻辑像素宽度（CSS px） */
const canvasW = ref(800);
/** 画布逻辑像素高度（CSS px） */
const canvasH = ref(220);

/** 频响曲线采样点数（对数分布 20Hz ~ 20kHz） */
const FREQ_POINT_COUNT = 96;
/** 频响 Y 轴范围（±dB） */
const FREQ_Y_RANGE_DB = 18;

/** 对数刻度频率数组（20 ~ 20000 Hz） */
const freqs = computed(() => {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  const step = (max - min) / (FREQ_POINT_COUNT - 1);
  return Array.from({ length: FREQ_POINT_COUNT }, (_, i) => Math.pow(10, min + step * i));
});

/** 频响曲线 dB 数组（与 freqs 一一对应） */
const responseDb = ref<number[]>(freqs.value.map(() => 0));

/** 拉取频响曲线 */
const refreshResponse = async (): Promise<void> => {
  if (!eq.enabled.value || eq.bypass.value) {
    responseDb.value = freqs.value.map(() => 0);
    return;
  }
  responseDb.value = await eq.fetchFrequencyResponse(freqs.value);
};

/** 防抖刷新频响曲线（band 变化时） */
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
const scheduleRefresh = (): void => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    void refreshResponse();
  }, 30);
};

watch(
  () =>
    [
      eq.bands.value,
      eq.preamp.value,
      eq.bassBoost.value,
      eq.trebleBoost.value,
      eq.enabled.value,
      eq.bypass.value,
    ] as const,
  () => scheduleRefresh(),
  { deep: true },
);

/** 频率 → X 坐标（对数刻度） */
const freqToX = (freq: number): number => {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  const clamped = Math.min(max, Math.max(min, Math.log10(Math.max(1, freq))));
  return ((clamped - min) / (max - min)) * canvasW.value;
};

/** X 坐标 → 频率（对数刻度） */
const xToFreq = (x: number): number => {
  const min = Math.log10(20);
  const max = Math.log10(20000);
  const ratio = Math.min(1, Math.max(0, x / canvasW.value));
  return Math.pow(10, min + ratio * (max - min));
};

/** 增益 → Y 坐标（0 在中线，+db 向上） */
const gainToY = (gainDb: number): number => {
  const ratio = Math.max(-1, Math.min(1, gainDb / FREQ_Y_RANGE_DB));
  return canvasH.value / 2 - ratio * (canvasH.value / 2);
};

/** Y 坐标 → 增益 */
const yToGain = (y: number): number => {
  const center = canvasH.value / 2;
  const ratio = (center - y) / (canvasH.value / 2);
  return Math.max(-15, Math.min(15, ratio * FREQ_Y_RANGE_DB));
};

/** 绘制频响曲线 */
const drawCurve = (): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const cssW = canvasW.value;
  const cssH = canvasH.value;
  canvas.width = Math.max(1, Math.floor(cssW * dpr));
  canvas.height = Math.max(1, Math.floor(cssH * dpr));
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);

  // 背景
  const bg = getComputedStyle(canvas).getPropertyValue("--color-surface-container") || "#1c1c1c";
  ctx.fillStyle = bg.trim();
  ctx.fillRect(0, 0, cssW, cssH);

  // 网格
  const gridColor = "rgba(255, 255, 255, 0.08)";
  const axisColor = "rgba(255, 255, 255, 0.18)";
  const labelColor = "rgba(255, 255, 255, 0.5)";
  ctx.lineWidth = 1;
  ctx.font = "10px ui-monospace, monospace";

  // 垂直网格：20, 50, 100, 200, 500, 1k, 2k, 5k, 10k, 20k
  const vGridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
  for (const f of vGridFreqs) {
    const x = freqToX(f);
    ctx.strokeStyle = f === 1000 ? axisColor : gridColor;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssH);
    ctx.stroke();
    ctx.fillStyle = labelColor;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const label = f >= 1000 ? `${f / 1000}k` : `${f}`;
    ctx.fillText(label, x, cssH - 14);
  }

  // 水平网格：-15, -10, -5, 0, +5, +10, +15
  const hGridGains = [-15, -10, -5, 0, 5, 10, 15];
  for (const g of hGridGains) {
    const y = gainToY(g);
    ctx.strokeStyle = g === 0 ? axisColor : gridColor;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(cssW, y);
    ctx.stroke();
    ctx.fillStyle = labelColor;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${g > 0 ? "+" : ""}${g}`, 4, y);
  }

  // 频响曲线
  const pts = responseDb.value;
  if (pts.length > 1) {
    ctx.strokeStyle = "rgb(254, 121, 113)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const x = freqToX(freqs.value[i]);
      const y = gainToY(pts[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 0dB 以下的填充
    const zeroY = gainToY(0);
    ctx.fillStyle = "rgba(254, 121, 113, 0.12)";
    ctx.beginPath();
    ctx.moveTo(freqToX(freqs.value[0]), zeroY);
    for (let i = 0; i < pts.length; i++) {
      ctx.lineTo(freqToX(freqs.value[i]), gainToY(pts[i]));
    }
    ctx.lineTo(freqToX(freqs.value[pts.length - 1]), zeroY);
    ctx.closePath();
    ctx.fill();
  }

  // 频段控制点
  const pointColor = eq.bypass.value ? "rgba(160, 160, 160, 0.6)" : "rgb(255, 200, 80)";
  const pointBorderColor = "rgba(0, 0, 0, 0.6)";
  const selectedColor = "rgb(120, 200, 255)";
  for (const [idx, band] of eq.bands.value.entries()) {
    if (band.filterType === EqualizerFilterType.Passthrough) continue;
    const x = freqToX(band.freq);
    const y = gainToY(band.gain);
    const isSelected = idx === selectedBandIdx.value;
    ctx.fillStyle = isSelected ? selectedColor : pointColor;
    ctx.strokeStyle = pointBorderColor;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, isSelected ? 7 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 选中频段标号
    if (isSelected) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "bold 10px ui-sans-serif, system-ui";
      ctx.fillText(`${idx + 1}`, x, y);
    }
  }
};

/** ResizeObserver 监听容器宽度变化 */
let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  void refreshResponse();
  resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const w = entry.contentRect.width;
      if (w > 0) {
        canvasW.value = w;
        drawCurve();
      }
    }
  });
  if (canvasWrapRef.value) resizeObserver.observe(canvasWrapRef.value);
  watch(responseDb, drawCurve, { flush: "post" });
  watch([canvasW, canvasH], drawCurve, { flush: "post" });
  watch(() => eq.bands.value, drawCurve, { deep: true, flush: "post" });
  watch(() => eq.bypass.value, drawCurve, { flush: "post" });
  watch(selectedBandIdx, drawCurve, { flush: "post" });
  // 启动电平表轮询
  startLevelPolling();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  stopLevelPolling();
  if (refreshTimer) clearTimeout(refreshTimer);
});

/** 当前选中的频段索引（用于参数编辑） */
const selectedBandIdx = ref(0);

const selectedBand = computed<EqualizerBand | null>(() => {
  const bands = eq.bands.value;
  if (bands.length === 0) return null;
  const idx = Math.min(selectedBandIdx.value, bands.length - 1);
  return bands[idx];
});

const selectBand = (idx: number): void => {
  selectedBandIdx.value = idx;
};

/** 拖拽中的频段索引（null = 未拖拽） */
const draggingBandIdx = ref<number | null>(null);

/** 找到点击位置附近的频段（12px 半径内），返回索引或 null */
const findBandAtPoint = (x: number, y: number): number | null => {
  for (let i = eq.bands.value.length - 1; i >= 0; i--) {
    const band = eq.bands.value[i];
    if (band.filterType === EqualizerFilterType.Passthrough) continue;
    const bx = freqToX(band.freq);
    const by = gainToY(band.gain);
    const dx = bx - x;
    const dy = by - y;
    if (dx * dx + dy * dy <= 144) return i;
  }
  return null;
};

/** 鼠标按下：开始拖拽 */
const onCanvasMouseDown = (event: MouseEvent): void => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const idx = findBandAtPoint(x, y);
  if (idx !== null) {
    draggingBandIdx.value = idx;
    selectedBandIdx.value = idx;
    event.preventDefault();
  }
};

/** 鼠标移动（拖拽中） */
const onCanvasMouseMove = (event: MouseEvent): void => {
  if (draggingBandIdx.value === null) return;
  const canvas = canvasRef.value;
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const newFreq = Math.round(xToFreq(x));
  const newGain = Math.round(yToGain(y) * 10) / 10;
  eq.updateBand(draggingBandIdx.value, { freq: newFreq, gain: newGain });
};

/** 鼠标抬起：结束拖拽 */
const onCanvasMouseUp = (): void => {
  draggingBandIdx.value = null;
};

/** 在窗口级别监听 mousemove/mouseup（拖拽出 canvas 也能响应） */
onMounted(() => {
  window.addEventListener("mousemove", onCanvasMouseMove);
  window.addEventListener("mouseup", onCanvasMouseUp);
});
onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onCanvasMouseMove);
  window.removeEventListener("mouseup", onCanvasMouseUp);
});

/** 滤波器类型选项（i18n 标签） */
const filterTypeKeys: Record<number, string> = {
  [EqualizerFilterType.Passthrough]: "passthrough",
  [EqualizerFilterType.Peaking]: "peaking",
  [EqualizerFilterType.LowShelf]: "lowShelf",
  [EqualizerFilterType.HighShelf]: "highShelf",
  [EqualizerFilterType.LowPass]: "lowPass",
  [EqualizerFilterType.HighPass]: "highPass",
  [EqualizerFilterType.Notch]: "notch",
  [EqualizerFilterType.BandPass]: "bandPass",
};

const filterTypeOptions = computed(() =>
  Object.entries(filterTypeKeys).map(([value, key]) => ({
    value: Number(value),
    label: t(`equalizer.filterTypes.${key}`),
  })),
);

/** 更新选中频段参数 */
const updateSelected = (params: Partial<EqualizerBand>): void => {
  if (selectedBandIdx.value < 0 || selectedBandIdx.value >= eq.bands.value.length) return;
  eq.updateBand(selectedBandIdx.value, params);
};

/** 预设下拉选项（带 i18n） */
const presetOptions = computed(() =>
  eq.presetOptions.value.map((opt) => {
    if (opt.value === "custom") {
      return { value: opt.value, label: t("equalizer.preset.custom") };
    }
    if (opt.value.startsWith("custom:")) {
      return { value: opt.value, label: opt.label };
    }
    return {
      value: opt.value,
      label: t(`equalizer.preset.${opt.value}`),
    };
  }),
);

/** 保存预设弹层（内联输入） */
const showSavePreset = ref(false);
const newPresetName = ref("");
const onSavePreset = (): void => {
  const name = newPresetName.value.trim();
  if (!name) return;
  eq.saveCustomPreset(name);
  newPresetName.value = "";
  showSavePreset.value = false;
};

/** 自定义预设右键删除（在下拉中显示 × 按钮） */
const onDeleteCustomPreset = (id: string): void => {
  eq.deleteCustomPreset(id);
};

/** 自定义预设列表（用于下拉右侧的删除按钮显示） */
const customPresetList = computed(() => eq.customPresets.value);

/** 输入/输出电平（左/右声道，0~1 线性） */
const inputLevels = ref<[number, number]>([0, 0]);
const outputLevels = ref<[number, number]>([0, 0]);

let levelPollHandle: ReturnType<typeof setInterval> | null = null;
const startLevelPolling = (): void => {
  if (levelPollHandle) return;
  levelPollHandle = setInterval(async () => {
    if (!eq.enabled.value) {
      inputLevels.value = [0, 0];
      outputLevels.value = [0, 0];
      return;
    }
    const levels = await eq.fetchLevels();
    inputLevels.value = levels.input;
    outputLevels.value = levels.output;
  }, 200);
};
const stopLevelPolling = (): void => {
  if (levelPollHandle) {
    clearInterval(levelPollHandle);
    levelPollHandle = null;
  }
};

/** 电平表 dB 转换（用于显示） */
const toDb = (linear: number): number => {
  if (linear <= 0.0001) return -60;
  return Math.max(-60, Math.min(0, 20 * Math.log10(linear)));
};

/** 电平条高度百分比（-60dB ~ 0dB 映射到 0 ~ 100%） */
const levelHeight = (linear: number): number => {
  const db = toDb(linear);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
};

/** 数值范围常量（与原 EQ 控件一致） */
const BAND_MIN = -15;
const BAND_MAX = 15;
const BAND_STEP = 0.5;
const FREQ_MIN = 20;
const FREQ_MAX = 20000;
const Q_MIN = 0.1;
const Q_MAX = 24;
const Q_STEP = 0.1;
const PREAMP_MIN = -12;
const PREAMP_MAX = 12;
const SHELF_MIN = -12;
const SHELF_MAX = 12;
const SURROUND_MIN = 0;
const SURROUND_MAX = 3;
const SURROUND_STEP = 0.1;

const formatDb = (value: number): string => `${value > 0 ? "+" : ""}${value.toFixed(1)}dB`;
const formatSurround = (value: number): string => `${value.toFixed(1)}x`;
</script>

<template>
  <div class="eq-control" :class="{ disabled: !eq.enabled.value }">
    <div class="eq-header">
      <span class="eq-label">{{ t("equalizer.preset.label") }}</span>
      <div class="w-44">
        <SSelect
          :model-value="eq.currentPreset.value"
          :options="presetOptions"
          :disabled="!eq.enabled.value"
          @update:model-value="eq.applyPreset($event as EqualizerPreset)"
        />
      </div>
      <SButton
        variant="secondary"
        size="small"
        :disabled="!eq.enabled.value"
        :class="{ 'bypass-active': eq.bypass.value }"
        @click="eq.bypass.value = !eq.bypass.value"
      >
        {{ t("equalizer.bypass") }}{{ eq.bypass.value ? " · B" : " · A" }}
      </SButton>
      <SButton
        v-if="!showSavePreset"
        variant="secondary"
        size="small"
        :disabled="!eq.enabled.value"
        @click="showSavePreset = true"
      >
        {{ t("equalizer.savePreset") }}
      </SButton>
      <div v-else class="save-preset-inline">
        <input
          v-model="newPresetName"
          class="preset-name-input"
          :placeholder="t('equalizer.presetNamePlaceholder')"
          maxlength="32"
          @keydown.enter="onSavePreset"
          @keydown.esc="showSavePreset = false"
        />
        <SButton type="primary" size="small" @click="onSavePreset">
          {{ t("common.confirm") }}
        </SButton>
        <SButton variant="secondary" size="small" @click="showSavePreset = false">
          {{ t("common.cancel") }}
        </SButton>
      </div>
      <div class="flex-1" />
      <SButton
        variant="secondary"
        size="small"
        :disabled="!eq.enabled.value"
        @click="eq.resetAll()"
      >
        {{ t("common.reset") }}
      </SButton>
      <SSwitch :model-value="eq.enabled.value" @update:model-value="eq.enabled.value = $event" />
    </div>

    <!-- 频响曲线 -->
    <div ref="canvasWrapRef" class="eq-curve-wrap">
      <canvas
        ref="canvasRef"
        class="eq-canvas"
        :style="{ height: `${canvasH}px` }"
        @mousedown="onCanvasMouseDown"
      />
      <div v-if="eq.bypass.value" class="bypass-overlay">BYPASS</div>
    </div>

    <!-- 频段参数编辑 -->
    <SCard class="eq-band-editor">
      <div class="band-row">
        <div class="band-item">
          <div class="band-item-label">{{ t("equalizer.bandIndex") }}</div>
          <div class="band-select">
            <button
              v-for="(_, idx) in eq.bands.value"
              :key="idx"
              type="button"
              class="band-chip"
              :class="{ active: idx === selectedBandIdx }"
              :disabled="!eq.enabled.value"
              @click="selectBand(idx)"
            >
              {{ idx + 1 }}
            </button>
            <button
              v-if="eq.bands.value.length < 16"
              type="button"
              class="band-chip add"
              :disabled="!eq.enabled.value"
              @click="eq.addBand()"
            >
              +
            </button>
          </div>
        </div>
      </div>
      <div v-if="selectedBand" class="band-params">
        <div class="param">
          <label>{{ t("equalizer.freq") }}</label>
          <input
            type="number"
            :value="Math.round(selectedBand.freq)"
            :min="FREQ_MIN"
            :max="FREQ_MAX"
            :step="1"
            :disabled="!eq.enabled.value"
            class="param-input"
            @change="updateSelected({ freq: Number(($event.target as HTMLInputElement).value) })"
          />
          <span class="param-unit">Hz</span>
        </div>
        <div class="param">
          <label>Q</label>
          <input
            type="number"
            :value="selectedBand.q.toFixed(2)"
            :min="Q_MIN"
            :max="Q_MAX"
            :step="Q_STEP"
            :disabled="!eq.enabled.value"
            class="param-input"
            @change="updateSelected({ q: Number(($event.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="param">
          <label>{{ t("equalizer.filterType") }}</label>
          <SSelect
            :model-value="selectedBand.filterType"
            :options="filterTypeOptions"
            :disabled="!eq.enabled.value"
            @update:model-value="updateSelected({ filterType: Number($event) })"
          />
        </div>
        <div class="param gain-param">
          <label>{{ t("equalizer.gain") }}</label>
          <div class="gain-row">
            <input
              type="range"
              :value="selectedBand.gain"
              :min="BAND_MIN"
              :max="BAND_MAX"
              :step="BAND_STEP"
              :disabled="
                !eq.enabled.value ||
                selectedBand.filterType === EqualizerFilterType.Passthrough ||
                selectedBand.filterType === EqualizerFilterType.LowPass ||
                selectedBand.filterType === EqualizerFilterType.HighPass ||
                selectedBand.filterType === EqualizerFilterType.Notch ||
                selectedBand.filterType === EqualizerFilterType.BandPass
              "
              class="gain-range"
              @input="updateSelected({ gain: Number(($event.target as HTMLInputElement).value) })"
            />
            <span class="gain-value">{{ formatDb(selectedBand.gain) }}</span>
          </div>
        </div>
        <button
          v-if="eq.bands.value.length > 1"
          type="button"
          class="band-remove"
          :disabled="!eq.enabled.value"
          @click="eq.removeBand(selectedBandIdx)"
        >
          {{ t("equalizer.removeBand") }}
        </button>
      </div>
    </SCard>

    <!-- 自定义预设列表 -->
    <div v-if="customPresetList.length > 0" class="custom-presets">
      <span class="eq-label">{{ t("equalizer.customPresets") }}</span>
      <div class="custom-preset-list">
        <div
          v-for="p in customPresetList"
          :key="p.id"
          class="custom-preset-item"
          :class="{ active: eq.currentPreset.value === `custom:${p.id}` }"
        >
          <button
            type="button"
            class="custom-preset-name"
            :disabled="!eq.enabled.value"
            @click="eq.applyCustomPreset(p)"
          >
            {{ p.name }}
          </button>
          <button
            type="button"
            class="custom-preset-delete"
            :title="t('common.delete')"
            @click="onDeleteCustomPreset(p.id)"
          >
            ×
          </button>
        </div>
      </div>
    </div>

    <!-- 底部：shelf 滑块 + 电平表 -->
    <SCard class="eq-footer">
      <div class="shelf-section">
        <div class="shelf-band">
          <div class="band-value">{{ formatDb(eq.preamp.value) }}</div>
          <div class="shelf-slider-wrap">
            <SSlider
              :model-value="eq.preamp.value"
              :min="PREAMP_MIN"
              :max="PREAMP_MAX"
              :step="1"
              :show-popover="false"
              vertical
              center-fill
              :thumb-size="14"
              :track-height="4"
              :disabled="!eq.enabled.value"
              @change="(v: number) => eq.setPreamp(v)"
              @drag-end="() => {}"
            >
              <template #popover="{ value }">{{ formatDb(value) }}</template>
            </SSlider>
          </div>
          <div class="band-label">{{ t("equalizer.preamp") }}</div>
        </div>
        <div class="shelf-band">
          <div class="band-value">{{ formatDb(eq.bassBoost.value) }}</div>
          <div class="shelf-slider-wrap">
            <SSlider
              :model-value="eq.bassBoost.value"
              :min="SHELF_MIN"
              :max="SHELF_MAX"
              :step="1"
              :show-popover="false"
              vertical
              center-fill
              :thumb-size="14"
              :track-height="4"
              :disabled="!eq.enabled.value"
              @change="(v: number) => eq.setBassBoost(v)"
              @drag-end="() => {}"
            >
              <template #popover="{ value }">{{ formatDb(value) }}</template>
            </SSlider>
          </div>
          <div class="band-label">{{ t("equalizer.bass") }}</div>
        </div>
        <div class="shelf-band">
          <div class="band-value">{{ formatDb(eq.trebleBoost.value) }}</div>
          <div class="shelf-slider-wrap">
            <SSlider
              :model-value="eq.trebleBoost.value"
              :min="SHELF_MIN"
              :max="SHELF_MAX"
              :step="1"
              :show-popover="false"
              vertical
              center-fill
              :thumb-size="14"
              :track-height="4"
              :disabled="!eq.enabled.value"
              @change="(v: number) => eq.setTrebleBoost(v)"
              @drag-end="() => {}"
            >
              <template #popover="{ value }">{{ formatDb(value) }}</template>
            </SSlider>
          </div>
          <div class="band-label">{{ t("equalizer.treble") }}</div>
        </div>
        <div class="shelf-band">
          <div class="band-value">{{ formatSurround(eq.surround.value) }}</div>
          <div class="shelf-slider-wrap">
            <SSlider
              :model-value="eq.surround.value"
              :min="SURROUND_MIN"
              :max="SURROUND_MAX"
              :step="SURROUND_STEP"
              :show-popover="false"
              vertical
              center-fill
              :thumb-size="14"
              :track-height="4"
              :disabled="!eq.enabled.value"
              @change="(v: number) => eq.setSurround(v)"
              @drag-end="() => {}"
            >
              <template #popover="{ value }">{{ formatSurround(value) }}</template>
            </SSlider>
          </div>
          <div class="band-label">{{ t("equalizer.surround") }}</div>
        </div>
      </div>
      <SDivider vertical class="!h-auto self-stretch mx-2" />
      <div class="meter-section">
        <div class="meter-group">
          <div class="meter-label">{{ t("equalizer.inputLevel") }}</div>
          <div class="meter-bars">
            <div class="meter-bar">
              <div class="meter-fill" :style="{ height: `${levelHeight(inputLevels[0])}%` }" />
              <span class="meter-text">L</span>
            </div>
            <div class="meter-bar">
              <div class="meter-fill" :style="{ height: `${levelHeight(inputLevels[1])}%` }" />
              <span class="meter-text">R</span>
            </div>
          </div>
        </div>
        <div class="meter-group">
          <div class="meter-label">{{ t("equalizer.outputLevel") }}</div>
          <div class="meter-bars">
            <div class="meter-bar">
              <div
                class="meter-fill output"
                :style="{ height: `${levelHeight(outputLevels[0])}%` }"
              />
              <span class="meter-text">L</span>
            </div>
            <div class="meter-bar">
              <div
                class="meter-fill output"
                :style="{ height: `${levelHeight(outputLevels[1])}%` }"
              />
              <span class="meter-text">R</span>
            </div>
          </div>
        </div>
      </div>
    </SCard>
  </div>
</template>

<style scoped>
.eq-control {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}
.eq-control.disabled .eq-curve-wrap,
.eq-control.disabled .eq-band-editor,
.eq-control.disabled .eq-footer {
  opacity: 0.5;
  pointer-events: none;
}
.eq-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.eq-label {
  font-size: 13px;
  color: var(--color-on-surface-variant);
}
.bypass-active {
  background: var(--color-primary-container, rgba(254, 121, 113, 0.2));
  color: var(--color-on-primary-container, rgb(254, 121, 113));
}
.save-preset-inline {
  display: flex;
  align-items: center;
  gap: 4px;
}
.preset-name-input {
  width: 140px;
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  background: var(--color-surface-container-high, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--color-outline-variant, rgba(255, 255, 255, 0.1));
  border-radius: 6px;
  color: var(--color-on-surface, #fff);
  outline: none;
}
.preset-name-input:focus {
  border-color: var(--color-primary, rgb(254, 121, 113));
}
.eq-curve-wrap {
  position: relative;
  width: 100%;
  background: var(--color-surface-container, #1c1c1c);
  border-radius: 8px;
  overflow: hidden;
}
.eq-canvas {
  display: block;
  width: 100%;
  cursor: crosshair;
}
.bypass-overlay {
  position: absolute;
  top: 8px;
  right: 12px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgba(254, 121, 113, 0.9);
  background: rgba(0, 0, 0, 0.4);
  padding: 2px 8px;
  border-radius: 4px;
  pointer-events: none;
}
.eq-band-editor {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.band-row {
  display: flex;
  gap: 12px;
  align-items: center;
}
.band-item {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.band-item-label {
  font-size: 11px;
  color: var(--color-on-surface-variant);
  min-width: 48px;
}
.band-select {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.band-chip {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--color-outline-variant, rgba(255, 255, 255, 0.2));
  background: transparent;
  color: var(--color-on-surface-variant, #ccc);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.band-chip:hover:not(:disabled) {
  border-color: var(--color-primary, rgb(254, 121, 113));
  color: var(--color-on-surface, #fff);
}
.band-chip.active {
  background: var(--color-primary, rgb(254, 121, 113));
  border-color: var(--color-primary, rgb(254, 121, 113));
  color: #fff;
}
.band-chip.add {
  width: 24px;
  font-size: 14px;
  line-height: 1;
}
.band-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.band-params {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 8px;
  border-top: 1px solid var(--color-outline-variant, rgba(255, 255, 255, 0.08));
}
.param {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.param label {
  color: var(--color-on-surface-variant);
  white-space: nowrap;
}
.param-input {
  width: 80px;
  height: 26px;
  padding: 0 6px;
  font-size: 12px;
  background: var(--color-surface-container-high, rgba(255, 255, 255, 0.05));
  border: 1px solid var(--color-outline-variant, rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  color: var(--color-on-surface, #fff);
  outline: none;
  font-variant-numeric: tabular-nums;
}
.param-input:focus {
  border-color: var(--color-primary, rgb(254, 121, 113));
}
.param-unit {
  color: var(--color-on-surface-variant);
  font-size: 11px;
}
.gain-param {
  flex: 1;
  min-width: 200px;
}
.gain-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
}
.gain-range {
  flex: 1;
  height: 4px;
  -webkit-appearance: none;
  appearance: none;
  background: var(--color-surface-container-highest, rgba(255, 255, 255, 0.1));
  border-radius: 2px;
  outline: none;
}
.gain-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-primary, rgb(254, 121, 113));
  cursor: pointer;
}
.gain-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--color-primary, rgb(254, 121, 113));
  cursor: pointer;
  border: none;
}
.gain-range:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.gain-value {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--color-on-surface-variant);
  min-width: 48px;
  text-align: right;
}
.band-remove {
  font-size: 11px;
  color: var(--color-error, rgb(254, 121, 113));
  background: transparent;
  border: 1px solid var(--color-outline-variant, rgba(255, 255, 255, 0.2));
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
}
.band-remove:hover:not(:disabled) {
  background: rgba(254, 121, 113, 0.1);
}
.custom-presets {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.custom-preset-list {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.custom-preset-item {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 4px 2px 8px;
  border-radius: 12px;
  background: var(--color-surface-container-high, rgba(255, 255, 255, 0.05));
  font-size: 11px;
}
.custom-preset-item.active {
  background: var(--color-primary-container, rgba(254, 121, 113, 0.2));
  color: var(--color-on-primary-container, rgb(254, 121, 113));
}
.custom-preset-name {
  background: transparent;
  border: none;
  color: inherit;
  font-size: 11px;
  cursor: pointer;
  padding: 2px 0;
}
.custom-preset-name:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.custom-preset-delete {
  background: transparent;
  border: none;
  color: var(--color-on-surface-variant, #999);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 50%;
}
.custom-preset-delete:hover {
  color: var(--color-error, rgb(254, 121, 113));
  background: rgba(254, 121, 113, 0.1);
}
.eq-footer {
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 12px;
}
.shelf-section {
  display: flex;
  gap: 8px;
  align-items: stretch;
}
.shelf-band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 52px;
}
.shelf-slider-wrap {
  height: 100px;
  display: flex;
  justify-content: center;
  align-items: center;
}
.band-value {
  height: 14px;
  font-size: 10px;
  color: var(--color-on-surface-variant);
  font-variant-numeric: tabular-nums;
}
.band-label {
  font-size: 10px;
  color: var(--color-on-surface-variant);
  white-space: nowrap;
}
.meter-section {
  display: flex;
  gap: 12px;
  align-items: stretch;
}
.meter-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.meter-label {
  font-size: 10px;
  color: var(--color-on-surface-variant);
  white-space: nowrap;
}
.meter-bars {
  display: flex;
  gap: 4px;
  height: 100px;
  align-items: flex-end;
}
.meter-bar {
  position: relative;
  width: 12px;
  height: 100%;
  background: var(--color-surface-container-highest, rgba(255, 255, 255, 0.05));
  border-radius: 2px;
  overflow: hidden;
  display: flex;
  align-items: flex-end;
}
.meter-fill {
  width: 100%;
  background: linear-gradient(to top, rgb(80, 200, 120), rgb(254, 200, 80), rgb(254, 121, 113));
  transition: height 0.05s linear;
}
.meter-fill.output {
  background: linear-gradient(to top, rgb(120, 180, 255), rgb(254, 200, 80), rgb(254, 121, 113));
}
.meter-text {
  position: absolute;
  bottom: 2px;
  left: 0;
  right: 0;
  text-align: center;
  font-size: 9px;
  color: rgba(0, 0, 0, 0.6);
  font-weight: 700;
  pointer-events: none;
}
</style>
