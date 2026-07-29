<script setup lang="ts">
import type {
  RgbColor,
  RgbDeviceConfig,
  RgbEffectType,
  RgbSpectrumDirection,
  RgbVuDirection,
  RgbColorSource,
} from "@shared/types/rgbSync";
import { useSettingsStore } from "@/stores/settings";
import { useRgbSync } from "@/composables/useRgbSync";
import { toast } from "@/composables/useToast";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucidePlugZap from "~icons/lucide/plug-zap";
import IconLucideUnplug from "~icons/lucide/unplug";
import IconLucideChevronDown from "~icons/lucide/chevron-down";
import IconLucideFlaskConical from "~icons/lucide/flask-conical";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const settings = useSettingsStore();

const { status, connect, disconnect, refreshDevices, testColor } = useRgbSync();

const connecting = ref(false);
const disconnecting = ref(false);
const refreshing = ref(false);
const testingDeviceId = ref<number | null>(null);

/** 当前展开详细配置的设备 ID */
const expandedDeviceId = ref<number | null>(null);

/** 默认设备配置：用户首次启用某设备时写入 */
const buildDefaultDeviceConfig = (): RgbDeviceConfig => ({
  enabled: true,
  effect: "spectrum",
  colorSource: "cover",
  customColor: { r: 255, g: 255, b: 255 },
  spectrumBuckets: 16,
  spectrumDirection: "leftToRight",
  beatSensitivity: 50,
  beatColor: { r: 255, g: 255, b: 255 },
  beatDecay: 50,
  gradientSpeed: 50,
  gradientColors: [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
  ],
  vuColorLow: { r: 0, g: 0, b: 255 },
  vuColorHigh: { r: 255, g: 0, b: 0 },
  vuDirection: "bottomUp",
});

/** 读取设备配置；若不存在则返回默认值（不写入 store） */
const getDeviceConfig = (deviceId: number): RgbDeviceConfig => {
  const stored = settings.system.rgbSync.devices[deviceId];
  if (stored) return stored;
  return buildDefaultDeviceConfig();
};

/** 确保设备配置已写入 store（首次启用时调用） */
const ensureDeviceConfig = (deviceId: number): RgbDeviceConfig => {
  const stored = settings.system.rgbSync.devices[deviceId];
  if (stored) return stored;
  const fresh = buildDefaultDeviceConfig();
  settings.setSystem(`rgbSync.devices.${deviceId}`, fresh);
  return fresh;
};

/** 设备开关：开启时确保设备配置已写入 */
const setDeviceEnabled = (deviceId: number, v: boolean): void => {
  if (v) ensureDeviceConfig(deviceId);
  settings.setSystem(`rgbSync.devices.${deviceId}.enabled`, v);
};

/** 写入设备某字段（先确保配置已存在） */
const setDeviceField = <K extends keyof RgbDeviceConfig>(
  deviceId: number,
  field: K,
  value: RgbDeviceConfig[K],
): void => {
  ensureDeviceConfig(deviceId);
  settings.setSystem(`rgbSync.devices.${deviceId}.${field}`, value);
};

/** 切换设备展开 */
const toggleExpand = (deviceId: number): void => {
  if (expandedDeviceId.value === deviceId) {
    expandedDeviceId.value = null;
  } else {
    expandedDeviceId.value = deviceId;
    ensureDeviceConfig(deviceId);
  }
};

/** 连接 OpenRGB */
const handleConnect = async (): Promise<void> => {
  connecting.value = true;
  try {
    await connect();
  } finally {
    connecting.value = false;
  }
};

/** 断开 OpenRGB */
const handleDisconnect = async (): Promise<void> => {
  disconnecting.value = true;
  try {
    await disconnect();
  } finally {
    disconnecting.value = false;
  }
};

/** 刷新设备列表 */
const handleRefresh = async (): Promise<void> => {
  refreshing.value = true;
  try {
    await refreshDevices();
  } finally {
    refreshing.value = false;
  }
};

/** 测试颜色：将设备所有 LED 临时设置为指定颜色 */
const handleTestColor = async (deviceId: number): Promise<void> => {
  testingDeviceId.value = deviceId;
  try {
    const color = getDeviceConfig(deviceId).customColor;
    await testColor(deviceId, color);
    toast.success(t("rgbSync.testColor.success"));
  } catch {
    toast.error(t("rgbSync.testColor.failed"));
  } finally {
    testingDeviceId.value = null;
  }
};

/** 效果模式下拉选项 */
const effectOptions = computed(() => [
  { value: "spectrum", label: t("rgbSync.effect.spectrum") },
  { value: "beat", label: t("rgbSync.effect.beat") },
  { value: "color", label: t("rgbSync.effect.color") },
  { value: "gradient", label: t("rgbSync.effect.gradient") },
  { value: "vu", label: t("rgbSync.effect.vu") },
]);

/** 频谱方向选项 */
const spectrumDirectionOptions = computed(() => [
  { value: "leftToRight", label: t("rgbSync.direction.leftToRight") },
  { value: "centerOut", label: t("rgbSync.direction.centerOut") },
  { value: "mirror", label: t("rgbSync.direction.mirror") },
]);

/** 音量计方向选项 */
const vuDirectionOptions = computed(() => [
  { value: "bottomUp", label: t("rgbSync.direction.bottomUp") },
  { value: "centerOut", label: t("rgbSync.direction.centerOut") },
]);

/** 颜色来源选项 */
const colorSourceOptions = computed(() => [
  { value: "cover", label: t("rgbSync.params.coverColor") },
  { value: "custom", label: t("rgbSync.params.customColor") },
]);

/** RgbColor <-> "rgb(r, g, b)" 字符串互转（SColor 控件使用字符串）
 * I6 修复：解析时钳制 0-255，避免存储非法值 */
const clampChannel = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
const rgbToString = (c: RgbColor): string => `rgb(${c.r}, ${c.g}, ${c.b})`;
const parseRgbString = (s: string): RgbColor => {
  const m = s.match(/(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)/);
  if (m) return { r: clampChannel(+m[1]), g: clampChannel(+m[2]), b: clampChannel(+m[3]) };
  return { r: 255, g: 255, b: 255 };
};

/** 渐变色列表操作 */
const setGradientColor = (deviceId: number, index: number, color: RgbColor): void => {
  const cfg = getDeviceConfig(deviceId);
  const next = [...cfg.gradientColors];
  next[index] = color;
  setDeviceField(deviceId, "gradientColors", next);
};

/** I5 修复：渐变色列表增删 */
const addGradientColor = (deviceId: number): void => {
  const cfg = getDeviceConfig(deviceId);
  // 上限 15 色，防止 LED 数较少时渐变过于密集
  if (cfg.gradientColors.length >= 15) return;
  const next = [...cfg.gradientColors, { r: 128, g: 128, b: 128 }];
  setDeviceField(deviceId, "gradientColors", next);
};

const removeGradientColor = (deviceId: number, index: number): void => {
  const cfg = getDeviceConfig(deviceId);
  // 至少保留 2 色，否则 computeGradient 会回退到 HSL 全色环
  if (cfg.gradientColors.length <= 2) return;
  const next = cfg.gradientColors.filter((_, i) => i !== index);
  setDeviceField(deviceId, "gradientColors", next);
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 顶部：连接状态 + 操作按钮 -->
    <div
      class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
    >
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0 flex-1 flex items-center gap-2">
          <span
            class="inline-block size-2 shrink-0 rounded-full"
            :class="status.connected ? 'bg-green-500' : 'bg-red-500'"
          />
          <span class="text-sm">
            {{
              status.connected
                ? t("rgbSync.status.connected")
                : status.error
                  ? t("rgbSync.status.error")
                  : t("rgbSync.status.disconnected")
            }}
          </span>
          <STag v-if="status.error" type="error" size="small">{{ status.error }}</STag>
        </div>
        <div class="shrink-0 flex items-center gap-2">
          <SButton
            v-if="!status.connected"
            type="primary"
            variant="secondary"
            size="small"
            :loading="connecting"
            @click="handleConnect"
          >
            <template #icon><IconLucidePlugZap class="size-4" /></template>
            {{ t("rgbSync.actions.connect") }}
          </SButton>
          <SButton
            v-else
            variant="secondary"
            size="small"
            type="error"
            :loading="disconnecting"
            @click="handleDisconnect"
          >
            <template #icon><IconLucideUnplug class="size-4" /></template>
            {{ t("rgbSync.actions.disconnect") }}
          </SButton>
          <SButton
            variant="secondary"
            size="small"
            :loading="refreshing"
            :disabled="!status.connected"
            @click="handleRefresh"
          >
            <template #icon><IconLucideRefreshCw class="size-4" /></template>
            {{ t("rgbSync.actions.refresh") }}
          </SButton>
        </div>
      </div>
    </div>

    <!-- 设备列表 -->
    <div v-if="status.devices.length === 0" class="text-sm text-on-surface-variant/60 px-1 py-4">
      {{ t("rgbSync.device.noDevices") }}
    </div>
    <div v-else class="flex flex-col gap-2.5">
      <div
        v-for="device in status.devices"
        :key="device.id"
        class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
      >
        <!-- 设备卡片头部：名称 + LED 数 + 启用开关 + 效果选择 + 展开按钮 -->
        <div class="flex items-center justify-between gap-4">
          <div class="min-w-0 flex-1">
            <div class="text-base truncate">{{ device.name }}</div>
            <div class="text-xs text-on-surface-variant/60 mt-0.5">
              {{ t("rgbSync.device.ledCount") }}: {{ device.ledCount }}
            </div>
          </div>
          <div class="shrink-0 flex items-center gap-3">
            <SSelect
              :model-value="getDeviceConfig(device.id).effect"
              :options="effectOptions"
              class="w-32"
              @update:model-value="
                (v) => setDeviceField(device.id, 'effect', v as RgbEffectType)
              "
            />
            <SButton
              variant="text"
              size="small"
              circle
              :loading="testingDeviceId === device.id"
              :disabled="!status.connected"
              :title="t('rgbSync.actions.test')"
              @click="handleTestColor(device.id)"
            >
              <IconLucideFlaskConical class="size-4" />
            </SButton>
            <SSwitch
              :model-value="getDeviceConfig(device.id).enabled"
              @update:model-value="(v) => setDeviceEnabled(device.id, v)"
            />
            <button
              type="button"
              class="size-7 rounded-md flex items-center justify-center text-on-surface-variant hover:bg-on-surface/8 transition-colors"
              :class="expandedDeviceId === device.id ? 'rotate-180' : ''"
              @click="toggleExpand(device.id)"
            >
              <IconLucideChevronDown class="size-4 transition-transform duration-200" />
            </button>
          </div>
        </div>

        <!-- 设备详细配置（展开时显示） -->
        <div
          v-if="expandedDeviceId === device.id"
          class="mt-4 pt-4 border-t border-outline-variant/10 flex flex-col gap-4 animate-fade-in"
        >
          <!-- 通用：颜色来源（color / gradient 效果使用） -->
          <template
            v-if="
              ['color', 'gradient'].includes(getDeviceConfig(device.id).effect)
            "
          >
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0 flex-1">
                <div class="text-sm">{{ t("rgbSync.params.colorSource") }}</div>
              </div>
              <SSelect
                :model-value="getDeviceConfig(device.id).colorSource"
                :options="colorSourceOptions"
                class="w-40"
                @update:model-value="
                  (v) => setDeviceField(device.id, 'colorSource', v as RgbColorSource)
                "
              />
            </div>
            <div
              v-if="getDeviceConfig(device.id).colorSource === 'custom'"
              class="flex items-center justify-between gap-4"
            >
              <div class="min-w-0 flex-1">
                <div class="text-sm">{{ t("rgbSync.params.customColor") }}</div>
              </div>
              <SColor
                :model-value="rgbToString(getDeviceConfig(device.id).customColor)"
                :show-alpha="false"
                format="rgb"
                @update:model-value="
                  (v) =>
                    setDeviceField(device.id, 'customColor', parseRgbString(v))
                "
              />
            </div>
          </template>

          <!-- spectrum 效果参数 -->
          <template v-if="getDeviceConfig(device.id).effect === 'spectrum'">
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-4">
                <span class="text-sm">{{ t("rgbSync.params.spectrumBuckets") }}</span>
                <span class="text-xs text-on-surface-variant tabular-nums">
                  {{ getDeviceConfig(device.id).spectrumBuckets }}
                </span>
              </div>
              <SSlider
                :model-value="getDeviceConfig(device.id).spectrumBuckets"
                :min="2"
                :max="32"
                :step="2"
                @update:model-value="
                  (v) => setDeviceField(device.id, 'spectrumBuckets', v)
                "
              />
            </div>
            <div class="flex items-center justify-between gap-4">
              <span class="text-sm">{{ t("rgbSync.params.spectrumDirection") }}</span>
              <SSelect
                :model-value="getDeviceConfig(device.id).spectrumDirection"
                :options="spectrumDirectionOptions"
                class="w-40"
                @update:model-value="
                  (v) =>
                    setDeviceField(
                      device.id,
                      'spectrumDirection',
                      v as RgbSpectrumDirection,
                    )
                "
              />
            </div>
          </template>

          <!-- beat 效果参数 -->
          <template v-if="getDeviceConfig(device.id).effect === 'beat'">
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-4">
                <span class="text-sm">{{ t("rgbSync.params.beatSensitivity") }}</span>
                <span class="text-xs text-on-surface-variant tabular-nums">
                  {{ getDeviceConfig(device.id).beatSensitivity }}
                </span>
              </div>
              <SSlider
                :model-value="getDeviceConfig(device.id).beatSensitivity"
                :min="0"
                :max="100"
                :step="1"
                @update:model-value="
                  (v) => setDeviceField(device.id, 'beatSensitivity', v)
                "
              />
            </div>
            <div class="flex items-center justify-between gap-4">
              <span class="text-sm">{{ t("rgbSync.params.beatColor") }}</span>
              <SColor
                :model-value="rgbToString(getDeviceConfig(device.id).beatColor)"
                :show-alpha="false"
                format="rgb"
                @update:model-value="
                  (v) => setDeviceField(device.id, 'beatColor', parseRgbString(v))
                "
              />
            </div>
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-4">
                <span class="text-sm">{{ t("rgbSync.params.beatDecay") }}</span>
                <span class="text-xs text-on-surface-variant tabular-nums">
                  {{ getDeviceConfig(device.id).beatDecay }}
                </span>
              </div>
              <SSlider
                :model-value="getDeviceConfig(device.id).beatDecay"
                :min="0"
                :max="100"
                :step="1"
                @update:model-value="(v) => setDeviceField(device.id, 'beatDecay', v)"
              />
            </div>
          </template>

          <!-- gradient 效果参数 -->
          <template v-if="getDeviceConfig(device.id).effect === 'gradient'">
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between gap-4">
                <span class="text-sm">{{ t("rgbSync.params.gradientSpeed") }}</span>
                <span class="text-xs text-on-surface-variant tabular-nums">
                  {{ getDeviceConfig(device.id).gradientSpeed }}
                </span>
              </div>
              <SSlider
                :model-value="getDeviceConfig(device.id).gradientSpeed"
                :min="0"
                :max="100"
                :step="1"
                @update:model-value="
                  (v) => setDeviceField(device.id, 'gradientSpeed', v)
                "
              />
            </div>
            <div class="flex flex-col gap-2">
              <div class="flex items-center justify-between">
                <span class="text-sm">{{ t("rgbSync.params.gradientColors") }}</span>
                <SButton
                  size="small"
                  variant="ghost"
                  :disabled="getDeviceConfig(device.id).gradientColors.length >= 15"
                  @click="addGradientColor(device.id)"
                >
                  + {{ t("rgbSync.actions.addColor") }}
                </SButton>
              </div>
              <div class="flex flex-wrap gap-2 mt-1">
                <div
                  v-for="(color, idx) in getDeviceConfig(device.id).gradientColors"
                  :key="idx"
                  class="flex items-center gap-1"
                >
                  <SColor
                    :model-value="rgbToString(color)"
                    :show-alpha="false"
                    format="rgb"
                    @update:model-value="
                      (v) => setGradientColor(device.id, idx, parseRgbString(v))
                    "
                  />
                  <SButton
                    v-if="getDeviceConfig(device.id).gradientColors.length > 2"
                    size="small"
                    variant="ghost"
                    @click="removeGradientColor(device.id, idx)"
                  >
                    ×
                  </SButton>
                </div>
              </div>
            </div>
          </template>

          <!-- vu 效果参数 -->
          <template v-if="getDeviceConfig(device.id).effect === 'vu'">
            <div class="flex items-center justify-between gap-4">
              <span class="text-sm">{{ t("rgbSync.params.vuColorLow") }}</span>
              <SColor
                :model-value="rgbToString(getDeviceConfig(device.id).vuColorLow)"
                :show-alpha="false"
                format="rgb"
                @update:model-value="
                  (v) => setDeviceField(device.id, 'vuColorLow', parseRgbString(v))
                "
              />
            </div>
            <div class="flex items-center justify-between gap-4">
              <span class="text-sm">{{ t("rgbSync.params.vuColorHigh") }}</span>
              <SColor
                :model-value="rgbToString(getDeviceConfig(device.id).vuColorHigh)"
                :show-alpha="false"
                format="rgb"
                @update:model-value="
                  (v) => setDeviceField(device.id, 'vuColorHigh', parseRgbString(v))
                "
              />
            </div>
            <div class="flex items-center justify-between gap-4">
              <span class="text-sm">{{ t("rgbSync.params.vuDirection") }}</span>
              <SSelect
                :model-value="getDeviceConfig(device.id).vuDirection"
                :options="vuDirectionOptions"
                class="w-40"
                @update:model-value="
                  (v) => setDeviceField(device.id, 'vuDirection', v as RgbVuDirection)
                "
              />
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
