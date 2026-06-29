<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useParallaxTilt } from "@/composables/useParallaxTilt";
import { useBreathing } from "@/composables/useBreathing";

withDefaults(defineProps<{ fullscreen?: boolean }>(), { fullscreen: false });

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();
const { isPlaying } = storeToRefs(status);

/**
 * 高清封面缓存：持有 ObjectURL（短字符串），不持有 base64 data URL（1-5MB 字符串）
 * 切歌时显式 revokeObjectURL 释放 Blob 引用，避免内存累积
 */
const hdCache = shallowRef<{ id: string; url: string } | null>(null);

/** 3D 视差倾斜 */
const { tiltStyle, onMouseMove, onMouseLeave } = useParallaxTilt({ maxTilt: 8 });

/** 是否启用视差 */
const parallaxEnabled = computed(() => settings.player.enableParallaxTilt);

/** 是否启用呼吸效果 */
const breathingEnabled = computed(() => settings.player.enableCoverBreathing);

/** 复用全局 breathing scale，与背景层共享节拍感 */
const { scale: breathingScale } = useBreathing();

/** 内层 DOM（节拍呼吸 scale，RAF 写） */
const innerEl = ref<HTMLDivElement | null>(null);

/** 暂停时缩到 0.9；播放时基准 1.0；外层用 CSS transition 平滑过渡 */
const outerScale = computed(() => (isPlaying.value ? 1 : 0.9));

/** 外层 transform：视差倾斜 + 播放/暂停 scale（由 Vue 响应式驱动，配合 CSS transition） */
const outerTransform = computed(() => {
  if (!parallaxEnabled.value) return undefined;
  return `${tiltStyle.value} scale(${outerScale.value})`;
});

/** RAF 节流间隔(ms),与后端 FFT 推送对齐,避免 60fps 冗余 DOM 写 */
const FRAME_INTERVAL = 32;
/** 上次 tick 时间戳 */
let lastTickTime = 0;

/**
 * 内层 RAF：写入节拍呼吸 scale
 *
 * breathingScale 在 RAF 中更新，若用 computed + :style 会触发响应式重渲染；
 * 这里直接写 DOM，把高频更新挡在 Vue 之外，与 Lyrics 引擎同套路
 * 30fps 节流与后端 FFT 推送对齐；暂停或呼吸禁用时写入 1.0 后停止 RAF
 */
const tick = (): void => {
  const now = performance.now();
  if (now - lastTickTime < FRAME_INTERVAL) return;
  lastTickTime = now;
  const el = innerEl.value;
  if (!el) return;
  const scale = breathingScale.value;
  el.style.transform = `scale(${scale.toFixed(4)})`;
};

const { resume, pause } = useRafFn(tick, { immediate: false });

/** RAF 激活条件：播放中 + 呼吸效果启用 */
const rafActive = computed(() => isPlaying.value && breathingEnabled.value);

watch(
  rafActive,
  (active) => {
    if (active) {
      lastTickTime = 0;
      resume();
    } else {
      pause();
      // 暂停/禁用时复位为 1.0,避免残留呼吸 scale
      const el = innerEl.value;
      if (el) el.style.transform = "scale(1)";
    }
  },
  { immediate: true },
);

const coverSrc = computed(() =>
  hdCache.value && hdCache.value.id === media.track?.id
    ? hdCache.value.url
    : media.track?.coverOriginal || media.track?.cover,
);

/**
 * 加载高清封面:base64 data URL → Blob → ObjectURL
 * 避免在 hdCache 中持有 1-5MB 的 base64 字符串,ObjectURL 仅是短引用
 */
watchEffect(async () => {
  const id = media.track?.id;
  if (!status.isExpanded || status.trackLoading || !id) return;
  if (media.track?.source !== "local" || hdCache.value?.id === id) return;
  const r = await window.api.player.getCoverRaw();
  if (media.track?.id !== id || !r.success || !r.data) return;
  // base64 data URL → Blob → ObjectURL,释放 hdCache 持有的旧 ObjectURL
  try {
    const resp = await fetch(r.data);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const prev = hdCache.value?.url;
    hdCache.value = { id, url };
    if (prev) URL.revokeObjectURL(prev);
  } catch {
    // Blob 转换失败时退回 data URL,功能不丢
    const prev = hdCache.value?.url;
    const fallbackUrl = r.data;
    hdCache.value = { id, url: fallbackUrl };
    if (prev && prev !== fallbackUrl) URL.revokeObjectURL(prev);
  }
});

onBeforeUnmount(() => {
  // 组件卸载时释放 ObjectURL,避免 Blob 内存泄漏
  const prev = hdCache.value?.url;
  if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  hdCache.value = null;
});
</script>

<template>
  <div
    :class="
      fullscreen
        ? 'relative isolate w-full h-full aspect-auto'
        : 'relative isolate w-full aspect-square'
    "
  >
    <div
      :class="
        fullscreen
          ? 'player-cover-fullscreen absolute inset-0 w-full h-full aspect-auto rounded-none bg-transparent overflow-hidden shrink-0 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]'
          : [
              'absolute inset-0 w-full aspect-square rounded-[32px] overflow-hidden shrink-0',
              'shadow-[0_0_20px_10px_rgba(0,0,0,0.1)]',
              'transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]',
              !parallaxEnabled ? (isPlaying ? 'scale-100' : 'scale-90') : '',
            ]
      "
      :style="parallaxEnabled ? { transform: outerTransform } : undefined"
      @mousemove="parallaxEnabled && onMouseMove($event)"
      @mouseleave="parallaxEnabled && onMouseLeave()"
    >
      <div ref="innerEl" class="absolute inset-0">
        <SImg :src="coverSrc" class="size-full" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.player-cover-fullscreen {
  mask-image: linear-gradient(
    to right,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.98) 10%,
    rgba(0, 0, 0, 0.92) 22%,
    rgba(0, 0, 0, 0.82) 32%,
    rgba(0, 0, 0, 0.68) 42%,
    rgba(0, 0, 0, 0.52) 52%,
    rgba(0, 0, 0, 0.36) 62%,
    rgba(0, 0, 0, 0.22) 72%,
    rgba(0, 0, 0, 0.1) 82%,
    rgba(0, 0, 0, 0.03) 92%,
    rgba(0, 0, 0, 0) 100%
  );
}
</style>
