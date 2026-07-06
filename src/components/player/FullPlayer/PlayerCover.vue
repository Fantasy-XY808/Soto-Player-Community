<script setup lang="ts">
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useParallaxTilt } from "@/composables/useParallaxTilt";
import { useBreathing } from "@/composables/useBreathing";
import { subscribeRaf } from "@/services/rafScheduler";

const props = withDefaults(defineProps<{ fullscreen?: boolean }>(), { fullscreen: false });

const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();
const { isPlaying } = storeToRefs(status);

/**
 * 高清封面缓存：持有 ObjectURL（短字符串），不持有 base64 data URL（1-5MB 字符串）
 * 切歌时显式 revokeObjectURL 释放 Blob 引用，避免内存累积
 */
const hdCache = shallowRef<{ id: string; url: string } | null>(null);

/** 3D 视差倾斜（非全屏封面用） */
const { tiltStyle, onMouseMove, onMouseLeave } = useParallaxTilt({ maxTilt: 8 });

/** 是否启用视差倾斜（非全屏） */
const parallaxEnabled = computed(() => settings.player.enableParallaxTilt);

/** 是否启用呼吸效果 */
const breathingEnabled = computed(() => settings.player.enableCoverBreathing);

/** 复用全局 breathing scale，与背景层共享节拍感 */
const { scale: breathingScale } = useBreathing();

/** 内层 DOM（节拍呼吸 scale，RAF 写） */
const innerEl = ref<HTMLDivElement | null>(null);

/** 暂停时缩到 0.9；播放时基准 1.0；外层用 CSS transition 平滑过渡 */
const outerScale = computed(() => (isPlaying.value ? 1 : 0.9));

/* ------------------------------------------------------------------ *
 * 全屏封面视差（fullscreen 模式专用）
 *
 * 与非全屏的 useParallaxTilt 不同：
 *   - 监听 window mousemove（全屏封面占大半屏，hover 触发不合适）
 *   - 两种方式：plane=2D 平移 / multi=透视倾斜
 *   - 强度滑块控制位移/倾斜幅度
 *   - lerp 平滑
 * ------------------------------------------------------------------ */

/** 视差强度（0~100 → 0~1） */
const parallaxIntensity = computed(() =>
  Math.max(0, Math.min(1, settings.appearance.coverParallaxIntensity / 100)),
);
/** 视差方式 */
const isMultiParallax = computed(
  () => settings.appearance.coverParallaxMode === "multi",
);
/** 全屏封面视差是否激活 */
const fullscreenParallaxActive = computed(
  () => settings.appearance.coverParallax,
);

/** 鼠标视差最大位移（px） */
const MOUSE_PARALLAX_MAX = 40;
/** 多维模式最大倾斜角度（度） */
const MULTI_TILT_MAX = 8;
/** 鼠标位置平滑系数 */
const MOUSE_LERP = 0.1;
/** RAF 节流间隔(ms) */
const PARALLAX_FRAME_INTERVAL = 16;

/** 平滑后的鼠标归一化坐标 (-1~1) */
let parallaxX = 0;
let parallaxY = 0;
/** 目标鼠标归一化坐标 */
let targetParallaxX = 0;
let targetParallaxY = 0;
/** 上次 tick 时间戳 */
let lastParallaxTick = 0;
/** 视差 RAF 订阅取消函数 */
let parallaxUnsubscribe: (() => void) | null = null;

/** window mousemove：归一化到 -1~1，存为目标值 */
const onWindowMouseMove = (e: MouseEvent): void => {
  targetParallaxX = (e.clientX / window.innerWidth - 0.5) * 2;
  targetParallaxY = (e.clientY / window.innerHeight - 0.5) * 2;
};

/** window 鼠标离开归零 */
const onWindowMouseLeave = (): void => {
  targetParallaxX = 0;
  targetParallaxY = 0;
};

/** 视差 RAF：lerp 平滑后写 transform */
const parallaxTick = (): void => {
  const now = performance.now();
  if (now - lastParallaxTick < PARALLAX_FRAME_INTERVAL) return;
  lastParallaxTick = now;
  const el = innerEl.value;
  if (!el) return;

  parallaxX += (targetParallaxX - parallaxX) * MOUSE_LERP;
  parallaxY += (targetParallaxY - parallaxY) * MOUSE_LERP;

  const intensity = parallaxIntensity.value;
  if (isMultiParallax.value) {
    // 多维：translate + rotateX/rotateY 透视倾斜
    const tx = -parallaxX * MOUSE_PARALLAX_MAX * intensity * 0.6;
    const ty = -parallaxY * MOUSE_PARALLAX_MAX * intensity * 0.6;
    const rotX = parallaxY * MULTI_TILT_MAX * intensity;
    const rotY = -parallaxX * MULTI_TILT_MAX * intensity;
    el.style.transform = `perspective(1200px) translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
  } else {
    // 平面：纯 2D translate
    const tx = -parallaxX * MOUSE_PARALLAX_MAX * intensity;
    const ty = -parallaxY * MOUSE_PARALLAX_MAX * intensity;
    el.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0)`;
  }
};

/** 启动全屏视差 */
const startFullscreenParallax = (): void => {
  const el = innerEl.value;
  if (el) el.style.willChange = "transform";
  if (!parallaxUnsubscribe) {
    parallaxUnsubscribe = subscribeRaf(parallaxTick, PARALLAX_FRAME_INTERVAL);
  }
  window.addEventListener("mousemove", onWindowMouseMove, { passive: true });
  window.addEventListener("mouseleave", onWindowMouseLeave);
};

/** 停止全屏视差 */
const stopFullscreenParallax = (): void => {
  if (parallaxUnsubscribe) {
    parallaxUnsubscribe();
    parallaxUnsubscribe = null;
  }
  window.removeEventListener("mousemove", onWindowMouseMove);
  window.removeEventListener("mouseleave", onWindowMouseLeave);
  parallaxX = 0;
  parallaxY = 0;
  targetParallaxX = 0;
  targetParallaxY = 0;
};

/**
 * 外层 transform（非全屏视差倾斜 + 播放/暂停 scale）
 * 全屏模式下不使用此路径，由内层 RAF 写视差 transform
 */
const outerTransform = computed(() => {
  if (!parallaxEnabled.value) return undefined;
  return `${tiltStyle.value} scale(${outerScale.value})`;
});

/** RAF 节流间隔(ms),与后端 FFT 推送对齐,避免 60fps 冗余 DOM 写 */
const FRAME_INTERVAL = 32;
/** 上次 tick 时间戳 */
let lastTickTime = 0;

/**
 * 内层 RAF：写入节拍呼吸 scale（仅在非全屏视差激活时使用）
 *
 * 全屏视差激活时，内层 transform 由全屏视差接管（含 breathing 偏移），
 * 此 RAF 不再写内层 transform，避免冲突
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

/** RAF 激活条件：播放中 + 呼吸效果启用 + 非全屏视差激活（全屏视差时内层由其接管） */
const rafActive = computed(
  () => isPlaying.value && breathingEnabled.value && !fullscreenParallaxActive.value,
);

watch(
  rafActive,
  (active) => {
    if (active) {
      lastTickTime = 0;
      resume();
    } else {
      pause();
      const el = innerEl.value;
      // 非全屏视差激活时才复位为 scale(1)，全屏视差时由其管理 transform
      if (el && !fullscreenParallaxActive.value) el.style.transform = "scale(1)";
    }
  },
  { immediate: true },
);

/** 全屏视差激活态切换 */
watch(
  fullscreenParallaxActive,
  (active) => {
    if (active && props.fullscreen) {
      startFullscreenParallax();
    } else {
      stopFullscreenParallax();
      // 退出全屏视差时复位内层 transform
      const el = innerEl.value;
      if (el) {
        el.style.willChange = "";
        el.style.transform = "scale(1)";
      }
    }
  },
  { immediate: true },
);

/** 切换 fullscreen 模式时启停视差 */
watch(
  () => props.fullscreen,
  (fs) => {
    if (fs && fullscreenParallaxActive.value) {
      startFullscreenParallax();
    } else {
      stopFullscreenParallax();
    }
  },
);

onBeforeUnmount(() => {
  stopFullscreenParallax();
  // 组件卸载时释放 ObjectURL,避免 Blob 内存泄漏
  const prev = hdCache.value?.url;
  if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  hdCache.value = null;
});

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
      :style="parallaxEnabled && !fullscreen ? { transform: outerTransform } : undefined"
      @mousemove="parallaxEnabled && !fullscreen && onMouseMove($event)"
      @mouseleave="parallaxEnabled && !fullscreen && onMouseLeave()"
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
