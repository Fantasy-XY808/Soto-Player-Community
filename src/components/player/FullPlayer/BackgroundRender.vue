<script setup lang="ts">
import {
  type AbstractBaseRenderer,
  type BaseRenderer,
  BackgroundRender as CoreBackgroundRender,
  MeshGradientRenderer,
} from "@applemusic-like-lyrics/core";
import { getFftFrame } from "@/services/playback";
import { acquireFft, releaseFft } from "@/services/fftCapture";
import { getBassPulse, toAmllLowFreqVolume } from "@/services/audioFeatures";

export interface BackgroundRenderProps {
  album?: string;
  playing?: boolean;
  flowSpeed?: number;
  hasLyric?: boolean;
  fps?: number;
  renderScale?: number;
  enableBeat?: boolean;
  brightness?: number;
  saturation?: number;
  contrast?: number;
  renderer?: new (...args: ConstructorParameters<typeof BaseRenderer>) => BaseRenderer;
}

const props = withDefaults(defineProps<BackgroundRenderProps>(), {
  playing: true,
  flowSpeed: 2,
  hasLyric: true,
  fps: 30,
  renderScale: 0.5,
  enableBeat: false,
  brightness: 1.0,
  saturation: 1.0,
  contrast: 1.0,
  renderer: () => MeshGradientRenderer,
});

const wrapperRef = ref<HTMLDivElement | null>(null);

const bgRenderRef = shallowRef<AbstractBaseRenderer>();

const updateRendererState = () => {
  const renderer = bgRenderRef.value;
  if (!renderer) return;

  if (props.album) {
    renderer.setAlbum(props.album, false);
  }
  renderer.setFPS(props.fps);
  renderer.setRenderScale(props.renderScale);
  renderer.setHasLyric(props.hasLyric);
  syncRendererMotion();
};

const syncRendererMotion = () => {
  const renderer = bgRenderRef.value;
  if (!renderer) return;

  if (props.playing) {
    renderer.setStaticMode(false);
    renderer.setFlowSpeed(props.flowSpeed);
    renderer.resume();
  } else {
    renderer.setFlowSpeed(0);
    renderer.resume();
  }
};

const BASS_ATTACK = 0.45;
const BASS_DECAY = 0.14;

let smoothedPulse = 0;
let lastFftFrame: readonly number[] = [];

const updateLowFreqVolume = () => {
  const data = getFftFrame();
  if (!data || data.length === 0) return;
  if (data === lastFftFrame) return;
  lastFftFrame = data;

  const pulse = getBassPulse(data);
  const smoothFactor = pulse > smoothedPulse ? BASS_ATTACK : BASS_DECAY;
  smoothedPulse = smoothedPulse + smoothFactor * (pulse - smoothedPulse);

  bgRenderRef.value?.setLowFreqVolume(toAmllLowFreqVolume(smoothedPulse));
};

const { resume: resumeFftLoop, pause: pauseFftLoop } = useRafFn(updateLowFreqVolume, {
  immediate: false,
});

let fftAcquired = false;

const startFftCapture = () => {
  if (!fftAcquired) {
    acquireFft();
    fftAcquired = true;
  }
  resumeFftLoop();
};

const stopFftCapture = () => {
  pauseFftLoop();
  if (fftAcquired) {
    releaseFft();
    fftAcquired = false;
  }
};

const syncFftCapture = () => {
  if (props.playing && props.enableBeat) {
    startFftCapture();
  } else {
    stopFftCapture();
    if (!props.enableBeat) {
      smoothedPulse = 0;
      lastFftFrame = [];
      bgRenderRef.value?.setLowFreqVolume(1.0);
    }
  }
};

onMounted(() => {
  if (!wrapperRef.value) return;

  bgRenderRef.value = CoreBackgroundRender.new(props.renderer);

  const el = bgRenderRef.value.getElement();
  el.style.width = "100%";
  el.style.height = "100%";
  el.style.display = "block";
  wrapperRef.value.appendChild(el);

  updateRendererState();
  syncFftCapture();
});

onBeforeUnmount(() => {
  stopFftCapture();

  const renderer = bgRenderRef.value;
  if (renderer) {
    renderer.pause();
    renderer.dispose();
    bgRenderRef.value = undefined;
  }
});

watch(
  () => props.album,
  (val) => {
    if (val && bgRenderRef.value) {
      bgRenderRef.value.setAlbum(val, false);
    }
  },
);

watch(
  () => props.playing,
  () => {
    syncRendererMotion();
    syncFftCapture();
  },
);

watch(
  () => props.enableBeat,
  () => syncFftCapture(),
);

watch(
  () => props.fps,
  (val) => {
    bgRenderRef.value?.setFPS(val);
  },
);

watch(
  () => props.flowSpeed,
  (val) => {
    if (props.playing) bgRenderRef.value?.setFlowSpeed(val);
  },
);

watch(
  () => props.renderScale,
  (val) => {
    bgRenderRef.value?.setRenderScale(val);
  },
);

watch(
  () => props.hasLyric,
  (val) => {
    bgRenderRef.value?.setHasLyric(val);
  },
);

const filterStyle = computed(
  () =>
    `brightness(${props.brightness}) saturate(${props.saturation}) contrast(${props.contrast})`,
);

defineExpose({
  bgRender: bgRenderRef,
  wrapperEl: wrapperRef,
});
</script>

<template>
  <div ref="wrapperRef" class="background-render-wrapper" :style="{ filter: filterStyle }" aria-hidden="true" />
</template>

<style scoped>
.background-render-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  z-index: 0;
  pointer-events: none;
}
</style>