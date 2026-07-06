<script setup lang="ts">
/**
 * 流体背景 — WebGL Fragment Shader 实现
 *
 * 参照 BetterLyrics 的 FluidBackgroundEffect HLSL 着色器,1:1 移植到 GLSL ES 1.0:
 * - 中心化 UV → 由 noise(time*0.1, tuv.x*tuv.y) 驱动整图旋转
 * - 双向正弦 UV 偏移,产生流体扰动
 * - 4 色按 -5° 旋转后的 X 轴 smoothstep 双层混合
 * - LightWave 通道:高频 HSV 纹波,提升流动感
 * - ScreenSpaceDither:消除大片渐变色带
 *
 * 标准 uniform 由 useBackgroundShader 自动注入:uTime / uResolution / uColor1~4 / uBass
 * 调色板从 props.palette 传入,不足 4 色时 composable 兜底补默认色
 *
 * WebGL 不可用时自动回退到 FluidBackgroundCanvas2D(Canvas 2D + CSS blur 近似实现)
 */

import { computed, ref } from "vue";
import { useStatusStore } from "@/stores/status";
import { useBackgroundShader } from "@/composables/useBackgroundShader";
import FluidBackgroundCanvas2D from "./FluidBackgroundCanvas2D.vue";

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface Props {
  dominantColor?: RGB | null;
  palette?: RGB[];
}

const props = withDefaults(defineProps<Props>(), {
  dominantColor: null,
  palette: () => [],
});

const status = useStatusStore();
const canvasRef = ref<HTMLCanvasElement | null>(null);

/**
 * GLSL fragment shader — 移植自 BetterLyrics FluidBackgroundEffect.cs
 *
 * 转换规则:
 * - float2/3/4 → vec2/3/4
 * - Hlsl.X → .x(小写)
 * - Hlsl.Dot → dot, Hlsl.Frac → fract, Hlsl.Lerp → mix
 * - Hlsl.Saturate(x) → clamp(x, 0.0, 1.0)
 * - Hlsl.SmoothStep → smoothstep
 * - D2D.GetScenePosition().XY → gl_FragCoord.xy
 * - 入口 Execute() → main(),返回 float4 → 写入 gl_FragColor
 *
 * 编译时常量(避免运行时分支开销):
 * - USE_HSV_BLENDING 0:用 RGB 直接 lerp,色彩更鲜艳(HSV 混合会减弱对比)
 * - ENABLE_LIGHT_WAVE 1:开启光波,提升流动感
 * - ENABLE_DITHERING 1:开启抖动,消除色带
 * - RANDOM_VALUE1~3:LightWave 用的随机偏移,固定值即可
 */
const FRAGMENT_SHADER = `
#define USE_HSV_BLENDING 0
#define ENABLE_LIGHT_WAVE 1
#define ENABLE_DITHERING 1
#define RANDOM_VALUE1 0.5
#define RANDOM_VALUE2 0.7
#define RANDOM_VALUE3 0.3

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform vec3 uColor4;
uniform float uBass;
uniform float uBrightness;
uniform float uSpeedMultiplier;

float range(float val, float mi, float ma) {
  return val * (ma - mi) + mi;
}

vec2 rotate2d(vec2 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}

// 二维哈希(返回 vec2,用于 gradient noise)
vec2 fHash(vec2 p) {
  p = vec2(dot(p, vec2(2127.1, 81.17)), dot(p, vec2(1269.5, 283.37)));
  return fract(sin(p) * 43758.5453);
}

// gradient-style value noise,返回 0~1
float fNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float n = mix(
    mix(dot(-1.0 + 2.0 * fHash(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
        dot(-1.0 + 2.0 * fHash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)),
        u.x),
    mix(dot(-1.0 + 2.0 * fHash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(-1.0 + 2.0 * fHash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)),
        u.x),
    u.y);
  return 0.5 + 0.5 * n;
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// 三角分布重映射,用于抖动
float remapTri(float v) {
  float orig = v * 2.0 - 1.0;
  v = orig / sqrt(abs(orig));
  v = max(-1.0, v);
  v = v - sign(orig) + 0.5;
  return v;
}

vec3 remapTri3(vec3 c) {
  return vec3(remapTri(c.r), remapTri(c.g), remapTri(c.b));
}

// 屏幕空间抖动,消除 32bit 色深下的色带
vec3 screenSpaceDither(vec2 vScreenPos, float t) {
  float colorDepth = 32.0;
  float dotValue = dot(vec2(131.0, 312.0), vScreenPos.xy + t);
  vec3 vDither = vec3(dotValue);
  vDither = fract(vDither / vec3(103.0, 71.0, 97.0));
  return remapTri3(vDither) / colorDepth;
}

// 光波通道:HSV 空间高频纹波,提升流动感
vec3 lightWave(vec3 inputColor, vec2 uv) {
  vec3 hsv = rgb2hsv(inputColor);
  vec2 p = -1.0 + 1.5 * uv.xy;
  float t = uTime / 5.0;
  float x = p.x;
  float y = p.y;

  float mov0 = x + y + cos(sin(t) * 2.0) * 100.0 + sin(x / 80.0) * 800.0;
  float mov1 = y / 0.25 + t;
  float mov2 = x / 0.15;

  float c1 = sin(mov1 + t + RANDOM_VALUE1) / 2.0 + mov2 / 2.0 - mov1 - mov2 + t;
  float c2 = cos(c1 + sin(mov0 / 1000.0 + t - RANDOM_VALUE2) + sin(y / 40.0 + t + RANDOM_VALUE3) + sin((x + y) / 100.0) * 3.0);
  float c3 = abs(sin(c2 + cos(mov1 + mov2 + c2) + cos(mov2) + sin(x / 1000.0)));

  vec3 col = hsv2rgb(vec3(
    range(abs(c2), hsv.x * 0.9, hsv.x * 1.05),
    range(c3, hsv.y * 0.9, hsv.y),
    range(c3, hsv.z * 0.8, hsv.z * 1.1)));
  return col;
}

void main() {
  vec2 scene = gl_FragCoord.xy;
  vec2 uv = scene / uResolution;

  vec2 tuv = uv - 0.5;

  float effectiveTime = uTime * uSpeedMultiplier;
  float degree = fNoise(vec2(effectiveTime * 0.1, tuv.x * tuv.y));
  tuv = rotate2d(tuv, radians((degree - 0.5) * 720.0 + 180.0));

  float frequency = 6.0;
  float amplitude = 18.0;
  float speed = effectiveTime * 0.9;

  vec3 diter = vec3(0.0);
#if ENABLE_DITHERING
  diter = screenSpaceDither(scene, uTime);
#endif

  tuv.x += sin(tuv.y * frequency + speed) / amplitude;
  tuv.y += sin((tuv.x * frequency) * 1.5 + speed) / (amplitude * 0.5);

  vec3 c1 = uColor1;
  vec3 c2 = uColor2;
  vec3 c3 = uColor3;
  vec3 c4 = uColor4;
#if USE_HSV_BLENDING
  c1 = rgb2hsv(c1);
  c2 = rgb2hsv(c2);
  c3 = rgb2hsv(c3);
  c4 = rgb2hsv(c4);
#endif

  float rotatedX = rotate2d(tuv, radians(-5.0)).x;

  vec3 layer1 = mix(c1, c2, smoothstep(-0.4, 0.3, rotatedX));
  vec3 layer2 = mix(c3, c4, smoothstep(-0.4, 0.3, rotatedX));

  vec3 finalComp = mix(layer1, layer2, smoothstep(0.6, -0.4, tuv.y));

  vec3 result;
#if ENABLE_LIGHT_WAVE
  result = lightWave(finalComp, uv) + diter;
#elif USE_HSV_BLENDING
  result = hsv2rgb(finalComp) + diter;
#else
  result = finalComp + diter;
#endif

  result *= uBrightness;

  gl_FragColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}
`;

/** enabled:展开时始终启用（暂停时降速但不停止，避免黑屏闪烁） */
const enabled = computed(() => status.isExpanded);

/** 暂停时速度倍率：保持缓慢流动，避免完全静止 */
const speedMultiplier = computed(() => (status.isPlaying ? 1.0 : 0.3));

const brightness = computed(() => 2.0);

/** palette 转 ref 供 composable 读取 */
const paletteRef = computed(() => props.palette);

const { isWebGLSupported } = useBackgroundShader(canvasRef, {
  fragmentShader: FRAGMENT_SHADER,
  enabled,
  palette: paletteRef,
  uniforms: () => ({
    uBrightness: brightness.value,
    uSpeedMultiplier: speedMultiplier.value,
  }),
});
</script>

<template>
  <!-- WebGL 不可用时回退到 Canvas 2D 实现 -->
  <FluidBackgroundCanvas2D
    v-if="!isWebGLSupported"
    :dominant-color="dominantColor"
    :palette="palette"
  />
  <canvas v-else ref="canvasRef" class="fluid-background" />
</template>

<style scoped>
/* WebGL shader 自身已通过 smoothstep + dither 产生柔和过渡,无需 CSS blur */
.fluid-background {
  position: absolute;
  inset: 0;
  pointer-events: none;
  will-change: auto;
}
</style>