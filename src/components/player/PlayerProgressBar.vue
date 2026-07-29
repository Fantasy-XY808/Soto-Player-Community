<script setup lang="ts">
/**
 * 播放进度条 + 时间文本（高性能版）
 *
 * 问题：status.position 以 10Hz 更新，原 PlayerBar / FullPlayer 直接在模板中
 * 引用 position，导致整个父组件（400+ 行模板）每 100ms 重渲染一次。
 *
 * 方案：本组件内部用 usePlaybackTime（共享 RAF）读取非响应式 getCurrentTime()，
 * - slider 的 model-value 通过 shallowRef 喂入，仅触发本组件 + SSlider 的最小重渲染
 * - 时间文本通过 DOM ref 直接写 textContent，完全绕过 Vue 响应式
 * - duration 仍走响应式（每首歌只变一次，开销可忽略）
 * - seek / 新歌载入时 watch status.position 跳变，立即同步 DOM
 *
 * 父组件不再引用 position，big template 不会被 10Hz position 变化触发重渲染。
 */
import { useStatusStore } from "@/stores/status";
import { usePlaybackTime } from "@/composables/usePlaybackTime";
import { useProgressLyric } from "@/composables/useProgressLyric";
import { getCurrentTime } from "@/services/playback";
import { formatTime } from "@/utils/time";

interface Props {
  /** 是否使用 cover 主题（FullPlayer 底栏用） */
  cover?: boolean;
  /** 是否显示 slider（分离布局下可设 false 仅展示时间文本） */
  showSlider?: boolean;
  /** slider step */
  step?: number;
  /** slider 轨道高度 */
  trackHeight?: number;
  /** slider 拖拽点大小 */
  thumbSize?: number;
  /** slider 是否始终显示拖拽点 */
  alwaysShowThumb?: boolean;
  /** slider 是否显示 popover（拖拽时的时间提示） */
  showPopover?: boolean;
  /** slider 自定义类 */
  sliderClass?: string;
  /** 是否在 slider 左侧显示当前时间（独立模式） */
  showCurrentTime?: boolean;
  /** 是否在 slider 右侧显示总时长（独立模式） */
  showDuration?: boolean;
  /** 是否显示组合时间 "current / duration"（与 showCurrentTime/showDuration 互斥） */
  showCombinedTime?: boolean;
  /** 时间文本样式类 */
  timeClass?: string;
  /** 容器样式类 */
  containerClass?: string;
}

withDefaults(defineProps<Props>(), {
  cover: false,
  showSlider: true,
  step: 100,
  trackHeight: 3,
  thumbSize: 10,
  alwaysShowThumb: false,
  showPopover: true,
  sliderClass: "",
  showCurrentTime: false,
  showDuration: false,
  showCombinedTime: false,
  timeClass: "",
  containerClass: "flex items-center gap-2 w-full",
});

const emit = defineEmits<{
  /** 拖拽结束，触发 seek */
  dragEnd: [value: number];
}>();

const status = useStatusStore();

/** 进度条歌词吸附 / 悬浮提示 */
const { formatTooltip, snapToNearestLyric } = useProgressLyric();

/**
 * 非响应式位置 ref（shallowRef：number 无深 proxy，仅触发本组件 render）
 * 喂给 SSlider 的 model-value，变化只引起 SSlider 重渲染，不波及父组件
 */
const positionRef = shallowRef(0);

/** 当前时间文本 DOM 引用（直接写 textContent，绕过 Vue 响应式） */
const currentTimeEl = ref<HTMLElement | null>(null);

/** duration 仍走响应式（低频：每首歌变一次） */
const durationRef = computed(() => status.duration);

const onSeekDragEnd = (value: number): void => {
  // 吸附到最近的歌词行（开启时）
  emit("dragEnd", snapToNearestLyric(value));
};

/** SSlider popover 内容：当前时间 + 当前时间对应的歌词文本 */
const renderPopover = (value: number): string => formatTooltip(value);

/** 把当前位置写入 slider ref + 时间文本 DOM */
const updateDisplay = (ms: number): void => {
  positionRef.value = ms;
  if (currentTimeEl.value) {
    currentTimeEl.value.textContent = formatTime(ms);
  }
};

/** 共享 RAF（30fps）读 getCurrentTime，仅触发本组件最小重渲染 */
const { start, stop } = usePlaybackTime((currentMs) => {
  updateDisplay(currentMs);
});

onMounted(() => {
  // 初始同步一次，避免首帧空白
  updateDisplay(Math.round(getCurrentTime()));
  start();
});

onBeforeUnmount(() => {
  stop();
});

/**
 * seek / 新歌载入同步：status.position 跳变时立即写 DOM
 *
 * - seek 期间 events.ts 跳过 status.position 赋值，seek 完成后跳到目标值
 * - 新歌 load 时 status.position 重置为 0 / 起始位置
 * 此时 RAF 可能还没拉到新值，直接写一次保证 UI 跟手
 */
watch(
  () => status.position,
  (pos) => updateDisplay(pos),
);
</script>

<template>
  <div :class="containerClass">
    <!-- 组合时间 "current / duration" -->
    <span v-if="showCombinedTime" :class="timeClass">
      <span ref="currentTimeEl" /> / {{ formatTime(durationRef) }}
    </span>
    <!-- 独立当前时间 -->
    <span v-else-if="showCurrentTime" ref="currentTimeEl" :class="timeClass" />
    <!-- slider -->
    <SSlider
      v-if="showSlider"
      :model-value="positionRef"
      :min="0"
      :max="durationRef"
      :step="step"
      :track-height="trackHeight"
      :thumb-size="thumbSize"
      :always-show-thumb="alwaysShowThumb"
      :show-popover="showPopover"
      :cover="cover"
      :class="sliderClass"
      @drag-end="onSeekDragEnd"
    >
      <template #popover="{ value }">{{ renderPopover(value) }}</template>
    </SSlider>
    <!-- 独立总时长 -->
    <span v-if="showDuration && !showCombinedTime" :class="timeClass">{{ formatTime(durationRef) }}</span>
  </div>
</template>
