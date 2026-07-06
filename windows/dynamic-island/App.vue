<script setup lang="ts">
import type { DynamicIslandSettings } from "@shared/types/settings";
import type { LyricLine } from "@shared/types/lyrics";
import { DYNAMIC_ISLAND_BASE_HEIGHT } from "@shared/defaults/settings";
import DEFAULT_COVER from "@/assets/images/song.jpg";
import IslandLyricLine from "./components/IslandLyricLine.vue";
import CoverFlip from "./components/CoverFlip.vue";
import GlassBackground from "./components/GlassBackground.vue";
import ExpandedView from "./components/ExpandedView.vue";
import { pickAdvanceOnEndIndex } from "@shared/utils/lyricSync";
import {
  useNowPlayingSync,
  getNowPlayingCurrentMs,
} from "@windows/shared/composables/useNowPlayingSync";
import { isPureMusic } from "@shared/utils/pureMusicDetect";
import { useExpandedView } from "./composables/useExpandedView";
import { useIslandLayout } from "./composables/useIslandLayout";
import { useIslandHide } from "./composables/useIslandHide";
import { useLyricTransition } from "./composables/useLyricTransition";
import { calculateMotionBlurSigma, MOTION_BLUR_EPSILON } from "./composables/useMotionBlur";
import { useDragWindow } from "./composables/useDragWindow";
import { isMac } from "@/utils/config";

const config = reactive<DynamicIslandSettings>({
  scale: 1,
  fontWeight: 500,
  fontFamily: "",
  wordByWord: true,
  playedColor: "rgba(255, 255, 255, 1)",
  unplayedColor: "rgba(255, 255, 255, 0.5)",
  backgroundColor: "rgba(0, 0, 0, 1)",
  alwaysOnTop: true,
  snapCentered: true,
  horizontalOffset: 0,
  notchFusion: false,
  nonOcclusive: false,
  doubleLine: false,
  showTranslation: false,
  showSpectrum: true,
  spectrumStyle: "gradient",
  enableExpandedView: true,
  expandedTimeout: 8,
  backgroundStyle: "solid",
  enableCoverFlip: true,
  widthMode: "adaptive",
  fixedWidth: 360,
  maxWidth: 480,
  overflowMode: "truncate",
  autoHide: false,
  autoHideDelay: 5,
  motionBlur: true,
  suppressFullscreen: true,
  autoStart: false,
});

const NOTCH_WIDTH = 181;
const NOTCH_HEIGHT = 29;
const NOTCH_TOP_FILL = 3;
const SHAPE_SIDE_OVERHANG = 5;
const MIN_SHAPE_WIDTH = NOTCH_WIDTH + SHAPE_SIDE_OVERHANG * 2;
const MAX_WINDOW_WIDTH_RATIO = 0.35;
const MIN_LYRIC_SCALE = 0.78;

/* 隐藏坨儿高度（px）：隐藏后保留的可视区域 */
const HIDDEN_HANDLE_HEIGHT = 5;
/* 隐藏时内容上滑距离（px） */
const HIDE_CONTENT_SLIDE = 30;
/* 拖拽触发隐藏的阈值（px） */
const HIDE_DRAG_THRESHOLD = 80;
/* 悬停隐藏：非遮挡模式下仅在鼠标悬停时透明 */
const hovering = ref(false);

/* 窗口尺寸计算 */
const mainRowHeight = computed(() => Math.round(DYNAMIC_ISLAND_BASE_HEIGHT * config.scale));

/* 主元素尺寸 */
const padX = computed(() => Math.round(mainRowHeight.value * 0.4));
const gap = computed(() => Math.round(mainRowHeight.value * 0.25));
const coverSize = computed(() => Math.round(mainRowHeight.value * 0.65));
const coverRadius = computed(() => Math.max(6, Math.round(coverSize.value * 0.35)));
const fontSize = computed(() => Math.max(13, Math.round(mainRowHeight.value * 0.5)));
const snapRadius = computed(() => Math.round(mainRowHeight.value * 0.6));
const shapeBottomRadius = computed(() => Math.max(14, Math.round(coverRadius.value * 2)));
/* 展开态圆角（对齐 WinIsland expanded 32px） */
const expandedRadius = 32;

/* 副行尺寸 */
const subFontSize = computed(() => Math.max(11, Math.round(fontSize.value * 0.65)));
const subRowHeight = computed(() => Math.round(subFontSize.value * 1.2));

/* 展开视图尺寸：600×200（对齐 WinIsland 360×200 比例，宽度加大以容纳更多内容） */
const EXPANDED_WIDTH = 600;
const EXPANDED_HEIGHT = 200;

const { track, lyric, primaryIndex, playing } = useNowPlayingSync({
  pickIndex: pickAdvanceOnEndIndex,
  logTag: "dynamic-island",
  fftEnabled: true,
});

/* 展开/收起状态 */
const { currentView, expand, collapse, resetTimer } = useExpandedView(8);
const isExpanded = computed(() => currentView.value === "expanded");

/* 多弹簧编排：替代单 expansionSpring，独立驱动 w/h/r/hide */
const initialW = Math.max(MIN_SHAPE_WIDTH, window.innerWidth || MIN_SHAPE_WIDTH);
const initialH = Math.max(NOTCH_HEIGHT, window.innerHeight || NOTCH_HEIGHT);
const layout = useIslandLayout({
  initialWidth: initialW,
  initialHeight: initialH,
  initialRadius: snapRadius.value,
});

/* 隐藏状态机 */
const hideState = useIslandHide({
  autoHide: computed(() => config.autoHide && !notchFusionEnabled.value && !isExpanded.value),
  autoHideDelay: computed(() => config.autoHideDelay),
  dragHideThreshold: HIDE_DRAG_THRESHOLD,
});

/* 上次发送给主进程的窗口宽度，用于动画起点与实际窗口同步 */
const lastSentWidth = ref(initialW);

watch(isExpanded, (expanded) => {
  /* 展开时锁定 hide 目标为 0（展开态不隐藏） */
  if (expanded && hideState.isHidden.value) hideState.show();
  const targetW = expanded ? EXPANDED_WIDTH : lastSentWidth.value;
  const targetH = expanded
    ? EXPANDED_HEIGHT
    : miniHeight.value + (notchFusionEnabled.value ? NOTCH_HEIGHT + NOTCH_TOP_FILL : 0);
  layout.setTargets({
    width: targetW,
    height: targetH,
    radius: expanded ? expandedRadius : snapRadius.value,
  });
});

watch(hideState.isHidden, (hidden) => {
  if (hidden) {
    /* 隐藏：高度塌缩到 handle，宽度保留便于恢复 */
    layout.setTargets({
      hide: 1,
      height: HIDDEN_HANDLE_HEIGHT,
    });
  } else {
    /* 展开：恢复到当前视图应有高度 */
    const targetH = isExpanded.value
      ? EXPANDED_HEIGHT
      : miniHeight.value + (notchFusionEnabled.value ? NOTCH_HEIGHT + NOTCH_TOP_FILL : 0);
    layout.setTargets({
      hide: 0,
      height: targetH,
    });
  }
});

/* mini 模式高度（非展开） */
const miniHeight = computed(
  () => contentHeight.value + (notchFusionEnabled.value ? NOTCH_HEIGHT + NOTCH_TOP_FILL : 0),
);

/* mini 宽度目标（用于派生 expansionProgress 与 hide 后恢复） */
const miniWidthTarget = ref(lastSentWidth.value);

/* 派生展开进度 0~1（对齐 WinIsland render.rs：从 spring_w 派生 expansion_progress） */
const expansionProgress = computed(() => {
  const miniW = miniWidthTarget.value;
  if (EXPANDED_WIDTH <= miniW) return isExpanded.value ? 1 : 0;
  return Math.max(0, Math.min(1, (layout.width.value - miniW) / (EXPANDED_WIDTH - miniW)));
});

/* 兼容旧引用：progress 即 expansionProgress */
const progress = expansionProgress;

/* 窗口高度：直接读 spring，下限为隐藏坨儿高度 */
const windowHeight = computed(() =>
  Math.max(HIDDEN_HANDLE_HEIGHT, Math.round(layout.height.value)),
);

/* 窗口宽度：直接读 spring，下限为最小形状宽度 */
const animatedWidth = computed(() => Math.max(MIN_SHAPE_WIDTH, Math.round(layout.width.value)));

/* alpha 交叉：mini 可见到 p=0.7，expanded 从 p=0.2 开始到 p=0.7 完成
 * 隐藏进度统一压制两层透明度 */
const hideAlpha = computed(() => 1 - layout.hide.value);
const miniAlpha = computed(() => Math.max(0, 1 - progress.value / 0.7) * hideAlpha.value);
const expandedAlpha = computed(
  () => Math.max(0, Math.min(1, (progress.value - 0.2) / 0.5)) * hideAlpha.value,
);

/* 隐藏时内容上滑 + 衰减透明度（驱动 .content 与 .expanded 的视觉塌缩） */
const contentHideOpacity = computed(() => hideAlpha.value);
const contentHideTranslateY = computed(() => -layout.hide.value * HIDE_CONTENT_SLIDE);

/* 播放位置/时长（用于展开视图进度条） */
const position = ref(0);
const duration = computed(() => track.value?.duration ?? 0);

/* 播放控制 */
const handleSeek = (ms: number): void => {
  position.value = ms;
  window.api.player.seek(ms);
  resetTimer();
  hideState.resetActivity();
};
const handlePrev = (): void => {
  window.api.player.dispatch("prev");
  resetTimer();
  hideState.resetActivity();
};
const handleNext = (): void => {
  window.api.player.dispatch("next");
  resetTimer();
  hideState.resetActivity();
};
const handleTogglePlay = (): void => {
  void window.api.player[playing.value ? "pause" : "play"]();
  resetTimer();
  hideState.resetActivity();
};

/* Mini 模式点击：隐藏态先展开隐藏坨儿，否则展开视图 */
const handleMiniClick = (): void => {
  if (hideState.isHidden.value) {
    hideState.show();
    return;
  }
  if (config.enableExpandedView && !isExpanded.value) {
    position.value = getNowPlayingCurrentMs();
    expand(config.expandedTimeout);
  }
};

/* 窗口失焦时自动收起展开视图 */
const handleWindowBlur = (): void => {
  if (isExpanded.value) collapse();
};

/* 窗口拖拽：非展开、非刘海融合、非穿透、非隐藏模式下允许 */
const { onContentPointerDown } = useDragWindow({
  enabled: () =>
    !isExpanded.value &&
    !notchFusionEnabled.value &&
    !config.nonOcclusive &&
    !hideState.isHidden.value,
  onClick: handleMiniClick,
  onDragMove: (_dx, dy) => {
    /* 向下拖拽超过阈值触发隐藏 */
    hideState.checkDragHide(dy);
  },
});

/* 窗口模式 */
const mode = ref<"snapped" | "floating">("snapped");
const viewportWidth = ref(initialW);
const viewportHeight = ref(Math.max(NOTCH_HEIGHT, window.innerHeight || NOTCH_HEIGHT));
const animatedShapeWidth = ref(viewportWidth.value);
const notchFusionEnabled = computed(() => isMac && config.notchFusion && mode.value === "snapped");
const isFixedWidth = computed(() => config.widthMode === "fixed" && !notchFusionEnabled.value);

/* 文本测量 */
const measureCtx = document.createElement("canvas").getContext("2d")!;
const measureTextWidth = (text: string, sizePx: number = fontSize.value): number => {
  const family = config.fontFamily || getComputedStyle(document.documentElement).fontFamily;
  measureCtx.font = `${config.fontWeight} ${sizePx}px ${family}`;
  return Math.ceil(measureCtx.measureText(text).width);
};

const artistsText = computed<string>(
  () => track.value?.artists?.map((a) => a.name).join(" / ") ?? "",
);

const currentLine = computed<LyricLine | null>(() => {
  const idx = primaryIndex.value;
  if (idx < 0) return null;
  return lyric.value[idx] ?? null;
});

const isInstrumental = computed<boolean>(() => {
  if (!track.value) return false;
  const lines = lyric.value;
  if (!lines || lines.length === 0) return true;
  const allEmpty = lines.every(
    (line) => !line.words || line.words.every((w) => !w.word || w.word.trim() === ""),
  );
  if (allEmpty) return true;
  return isPureMusic(lines);
});

const fallbackText = computed<string>(() => {
  const t = track.value;
  if (!t) return "Soto-Player";
  return artistsText.value ? `${t.title} - ${artistsText.value}` : t.title;
});

/* 当前显示的内容（新层） */
const displayLine = shallowRef<LyricLine | null>(null);
const displayFallback = ref("Soto-Player");
const displayIndex = ref(-1);
const displaySubText = ref("");

/* 转场期间的旧内容（旧层） */
const prevDisplayLine = shallowRef<LyricLine | null>(null);
const prevDisplayFallback = ref("Soto-Player");
const prevDisplaySubText = ref("");
const prevDisplayIndex = ref(-1);

const showSubLine = computed(() => config.doubleLine || displaySubText.value !== "");

const contentHeight = computed(
  () => mainRowHeight.value + (showSubLine.value ? subRowHeight.value : 0),
);

const BOUNCE_OVERSHOOT = 0.12;

const rawLyricWidth = ref(measureTextWidth(displayFallback.value));
const lyricWidth = ref(rawLyricWidth.value);

const lineText = (line: LyricLine): string => line.words.map((w) => w.word).join("");

const computeSubText = (idx: number, line: LyricLine | null): string => {
  if (config.showTranslation && line?.translatedLyric) return line.translatedLyric;
  if (!config.doubleLine || idx < 0) return "";
  const next = lyric.value[idx + 1];
  return next ? lineText(next) : "";
};

const measureTarget = (): number => {
  const line = currentLine.value;
  const mainText = line && !isInstrumental.value ? lineText(line) : fallbackText.value;
  const mainPx = Math.max(1, measureTextWidth(mainText));
  const subText = computeSubText(primaryIndex.value, line);
  const subPx = subText ? measureTextWidth(subText, subFontSize.value) : 0;
  return Math.max(mainPx, subPx);
};

const getRendererWindowLimit = (): number =>
  Math.max(
    MIN_SHAPE_WIDTH,
    Math.min(config.maxWidth, Math.floor(window.screen.width * MAX_WINDOW_WIDTH_RATIO)),
  );

const fixedContentWidth = computed(() => padX.value * 2 + coverSize.value + gap.value);
const shapeExtraWidth = computed(() => (notchFusionEnabled.value ? SHAPE_SIDE_OVERHANG * 2 : 0));

const maxLyricSlotWidth = computed(() => {
  if (isFixedWidth.value) {
    return Math.max(1, config.fixedWidth - fixedContentWidth.value - shapeExtraWidth.value);
  }
  const windowLimit = getRendererWindowLimit();
  if (notchFusionEnabled.value) {
    const currentWindowWidth = Math.max(MIN_SHAPE_WIDTH, viewportWidth.value);
    return Math.max(
      1,
      Math.min(windowLimit, currentWindowWidth) - fixedContentWidth.value - shapeExtraWidth.value,
    );
  }
  return Math.max(1, windowLimit - fixedContentWidth.value - shapeExtraWidth.value);
});

const getLyricSlotWidth = (lyricPx: number): number =>
  Math.min(Math.max(1, Math.round(lyricPx)), maxLyricSlotWidth.value);

const computeWindowWidth = (lyricPx: number): number => {
  if (isFixedWidth.value) {
    return config.fixedWidth;
  }
  const bounceExtra = Math.ceil(lyricPx * BOUNCE_OVERSHOOT);
  return Math.max(
    notchFusionEnabled.value ? MIN_SHAPE_WIDTH : 1,
    fixedContentWidth.value + lyricPx + bounceExtra + shapeExtraWidth.value,
  );
};

/* 调整窗口宽度：通过 layout 弹簧驱动，windowBounds watcher 统一上报 */
const resizeWindow = (lyricPx: number): void => {
  /* 展开或隐藏动画期间不调整宽度 */
  if (progress.value > 0.001) return;
  if (layout.hide.value > 0.5) return;
  const targetWidth = computeWindowWidth(lyricPx);
  lastSentWidth.value = targetWidth;
  miniWidthTarget.value = targetWidth;
  layout.setTargets({ width: targetWidth });
};

const applyMeasuredWidth = (targetPx: number): void => {
  rawLyricWidth.value = targetPx;
  lyricWidth.value = getLyricSlotWidth(targetPx);
  resizeWindow(targetPx);
};

const truncateTextToWidth = (text: string, maxWidth: number, sizePx: number): string => {
  if (!text || measureTextWidth(text, sizePx) <= maxWidth) return text;
  const ellipsis = "...";
  const ellipsisWidth = measureTextWidth(ellipsis, sizePx);
  if (maxWidth <= ellipsisWidth) return ellipsis;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measureTextWidth(`${text.slice(0, mid)}${ellipsis}`, sizePx) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low)}${ellipsis}`;
};

/* 歌词交叉淡化（替代 CSS swap 动画） */
const lyricTransition = useLyricTransition({
  speed: 0.06,
  maxBlurSigma: 10,
  maxOffsetY: 8,
});

/* 立即应用：跳过转场（首帧、展开中、隐藏中） */
const applyImmediate = (): void => {
  displayLine.value = currentLine.value;
  displayFallback.value = fallbackText.value;
  displayIndex.value = primaryIndex.value;
  displaySubText.value = computeSubText(primaryIndex.value, currentLine.value);
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
  lyricTransition.complete();
};

/* 触发交叉淡化：保存旧内容 → 更新到新内容 → 启动转场 */
const triggerLyricSwap = (): void => {
  prevDisplayLine.value = displayLine.value;
  prevDisplayFallback.value = displayFallback.value;
  prevDisplaySubText.value = displaySubText.value;
  prevDisplayIndex.value = displayIndex.value;

  displayLine.value = currentLine.value;
  displayFallback.value = fallbackText.value;
  displayIndex.value = primaryIndex.value;
  displaySubText.value = computeSubText(primaryIndex.value, currentLine.value);

  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
  lyricTransition.trigger();
};

/* 开关切换后立即重算副行 + 同步窗口宽度，不走转场 */
watch([() => config.doubleLine, () => config.showTranslation], () => {
  displaySubText.value = computeSubText(displayIndex.value, displayLine.value);
  if (lyricTransition.active.value) return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

watch([() => config.scale, () => config.fontWeight, () => config.fontFamily], () => {
  if (lyricTransition.active.value) return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

watch(notchFusionEnabled, () => {
  if (lyricTransition.active.value) return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

watch(
  [
    () => config.widthMode,
    () => config.fixedWidth,
    () => config.maxWidth,
    () => config.overflowMode,
  ],
  () => {
    if (lyricTransition.active.value) return;
    const targetPx = measureTarget();
    applyMeasuredWidth(targetPx);
  },
);

watch(isInstrumental, () => {
  if (lyricTransition.active.value) return;
  const targetPx = measureTarget();
  applyMeasuredWidth(targetPx);
});

/* 歌词变化：触发交叉淡化 */
let hasPainted = false;
watch([currentLine, fallbackText], () => {
  const newLine = currentLine.value;
  const changed = newLine
    ? displayIndex.value !== primaryIndex.value
    : displayFallback.value !== fallbackText.value;
  if (!changed) return;
  /* 首次 paint 尚未完成或 lyricWidth 为 0：跳过转场直接应用 */
  if (!hasPainted || lyricWidth.value === 0) {
    applyImmediate();
    return;
  }
  /* 展开/收起动画进行中：mini 歌词不可见，转场无意义 */
  if (progress.value > 0.001 && progress.value < 0.999) {
    applyImmediate();
    return;
  }
  /* 隐藏态：直接更新内容，不播转场 */
  if (layout.hide.value > 0.5) {
    applyImmediate();
    return;
  }
  triggerLyricSwap();
});

const lyricScale = computed(() => {
  if (!notchFusionEnabled.value) return 1;
  const rawWidth = Math.max(1, rawLyricWidth.value);
  const slotWidth = Math.max(1, lyricWidth.value);
  return Math.max(MIN_LYRIC_SCALE, Math.min(1, slotWidth / rawWidth));
});

const lyricLayoutWidth = computed(() =>
  Math.max(1, Math.floor(Math.max(1, lyricWidth.value) / lyricScale.value)),
);

const displayMainText = computed(() =>
  displayLine.value && !isInstrumental.value ? lineText(displayLine.value) : displayFallback.value,
);

const prevMainText = computed(() =>
  prevDisplayLine.value && !isInstrumental.value
    ? lineText(prevDisplayLine.value)
    : prevDisplayFallback.value,
);

const mainTextOverflow = computed(() => {
  const fullWidth = measureTextWidth(displayMainText.value, fontSize.value);
  return fullWidth > lyricLayoutWidth.value;
});

const fittedMainText = computed(() =>
  config.overflowMode === "truncate"
    ? truncateTextToWidth(displayMainText.value, lyricLayoutWidth.value, fontSize.value)
    : displayMainText.value,
);

const fittedPrevMainText = computed(() =>
  config.overflowMode === "truncate"
    ? truncateTextToWidth(prevMainText.value, lyricLayoutWidth.value, fontSize.value)
    : prevMainText.value,
);

const mainTextTruncated = computed(
  () => config.overflowMode === "truncate" && fittedMainText.value !== displayMainText.value,
);

const mainTextScrolling = computed(
  () => config.overflowMode === "scroll" && mainTextOverflow.value,
);

const fittedDisplayLine = computed<LyricLine | null>(() => {
  if (isInstrumental.value) return null;
  if (mainTextScrolling.value) return null;
  const line = displayLine.value;
  if (!line || !mainTextTruncated.value) return line;
  return {
    ...line,
    words: [
      {
        startTime: line.startTime,
        endTime: line.endTime,
        word: fittedMainText.value,
      },
    ],
  };
});

const fittedPrevDisplayLine = computed<LyricLine | null>(() => {
  if (isInstrumental.value) return null;
  const line = prevDisplayLine.value;
  if (!line) return null;
  /* 旧层不参与截断判定，直接用 prevMainText */
  return {
    ...line,
    words: [
      {
        startTime: line.startTime,
        endTime: line.endTime,
        word: fittedPrevMainText.value,
      },
    ],
  };
});

const fittedSubText = computed(() =>
  truncateTextToWidth(displaySubText.value, lyricLayoutWidth.value, subFontSize.value),
);

const fittedPrevSubText = computed(() =>
  truncateTextToWidth(prevDisplaySubText.value, lyricLayoutWidth.value, subFontSize.value),
);

const shapeWidth = computed(() => {
  if (progress.value > 0.001) {
    return Math.max(MIN_SHAPE_WIDTH, Math.round(animatedWidth.value));
  }
  return Math.max(
    MIN_SHAPE_WIDTH,
    Math.round(notchFusionEnabled.value ? animatedShapeWidth.value : viewportWidth.value),
  );
});
const shapeHeight = computed(() => Math.max(windowHeight.value, Math.round(viewportHeight.value)));

const notchPath = computed(() => {
  const width = shapeWidth.value;
  const height = shapeHeight.value;
  const overhang = Math.min(SHAPE_SIDE_OVERHANG, width / 4);
  const bodyLeft = overhang;
  const bodyRight = width - overhang;
  const topArc = Math.min(overhang, height / 4);
  const bottomRadius = Math.min(shapeBottomRadius.value, width / 2, height / 2);

  return [
    "M 0 0",
    `L ${width} 0`,
    `Q ${bodyRight} 0 ${bodyRight} ${topArc}`,
    `L ${bodyRight} ${height - bottomRadius}`,
    `Q ${bodyRight} ${height} ${bodyRight - bottomRadius} ${height}`,
    `L ${bodyLeft + bottomRadius} ${height}`,
    `Q ${bodyLeft} ${height} ${bodyLeft} ${height - bottomRadius}`,
    `L ${bodyLeft} ${topArc}`,
    `Q ${bodyLeft} 0 0 0`,
    "Z",
  ].join(" ");
});

/* 根节点样式 */
const rootStyle = computed(() => ({
  "--di-played": config.playedColor,
  "--di-unplayed": config.unplayedColor,
  "--di-bg": config.backgroundColor,
  "--di-padx": `${padX.value}px`,
  "--di-gap": `${gap.value}px`,
  "--di-cover": `${coverSize.value}px`,
  "--di-cover-radius": `${coverRadius.value}px`,
  "--di-side-overhang": `${notchFusionEnabled.value ? SHAPE_SIDE_OVERHANG : 0}px`,
  "--di-row": `${mainRowHeight.value}px`,
  "--di-content-height": `${contentHeight.value}px`,
  "--di-notch": `${NOTCH_HEIGHT}px`,
  "--di-shape-width": `${shapeWidth.value}px`,
  "--di-fusion-content-width": `${Math.max(1, shapeWidth.value - SHAPE_SIDE_OVERHANG * 2)}px`,
  "--di-snap-radius": `${snapRadius.value}px`,
  "--di-island-radius": `${layout.radius.value}px`,
  "--di-lyric-scale": lyricScale.value,
  "--di-lyric-slot": `${lyricLayoutWidth.value}px`,
  fontFamily: config.fontFamily || undefined,
}));

const syncViewportSize = (): void => {
  viewportWidth.value = Math.max(MIN_SHAPE_WIDTH, window.innerWidth || MIN_SHAPE_WIDTH);
  viewportHeight.value = Math.max(NOTCH_HEIGHT, window.innerHeight || NOTCH_HEIGHT);
  if (!notchFusionEnabled.value) {
    animatedShapeWidth.value = viewportWidth.value;
  }
};

watch(
  maxLyricSlotWidth,
  () => {
    if (lyricTransition.active.value) return;
    lyricWidth.value = getLyricSlotWidth(rawLyricWidth.value);
  },
  { flush: "post" },
);

/* 取消订阅 */
let unsubConfig: (() => void) | null = null;
let unsubMode: (() => void) | null = null;
let unsubCursor: (() => void) | null = null;
let positionIntervalId: number | null = null;
let motionBlurRaf = 0;

/* 窗口目标尺寸：合并宽高，单个 watcher 单次 IPC */
const windowBounds = computed(() => ({
  width: animatedWidth.value,
  height: windowHeight.value,
  expanded: progress.value > 0.001,
  hidden: layout.hide.value > 0.5,
}));

watch(
  windowBounds,
  ({ width, height, expanded, hidden }) => {
    if (hidden) {
      /* 隐藏态：仅上报高度塌缩，宽度保持便于恢复 */
      window.api.dynamicIsland.setHeight(height);
    } else if (expanded) {
      window.api.dynamicIsland.setBounds(width, height);
    } else {
      window.api.dynamicIsland.setHeight(height);
      /* mini 模式宽度由 layout 弹簧驱动，需要主动上报 */
      if (Math.abs(width - lastSentWidth.value) > 0.5) {
        window.api.dynamicIsland.resize(width);
        lastSentWidth.value = width;
      }
    }
  },
  { flush: "sync" },
);

/* 运动模糊：RAF 直接写 DOM style，避免响应式开销
 * 参照 WinIsland src/utils/blur.rs：sigmaX = min(|velW|*0.3 + |velView|*currentW*0.4, 12)
 * 作用于内容层（.content-layer）而非根节点，避免破坏根节点圆角与背景 */
const contentLayerRef = ref<HTMLElement | null>(null);
const motionBlurTick = (): void => {
  if (!config.motionBlur) {
    if (contentLayerRef.value) contentLayerRef.value.style.filter = "";
    motionBlurRaf = 0;
    return;
  }
  const el = contentLayerRef.value;
  if (!el) {
    motionBlurRaf = requestAnimationFrame(motionBlurTick);
    return;
  }
  const { sigmaX, sigmaY } = calculateMotionBlurSigma(
    layout.velocityW(),
    layout.velocityH(),
    layout.velocityView(),
    layout.width.value,
  );
  if (sigmaX < MOTION_BLUR_EPSILON && sigmaY < MOTION_BLUR_EPSILON) {
    if (el.style.filter) el.style.filter = "";
  } else {
    el.style.filter = `blur(${sigmaX.toFixed(2)}px ${sigmaY.toFixed(2)}px)`;
  }
  motionBlurRaf = requestAnimationFrame(motionBlurTick);
};

const startMotionBlur = (): void => {
  if (motionBlurRaf === 0 && config.motionBlur) {
    motionBlurRaf = requestAnimationFrame(motionBlurTick);
  }
};
const stopMotionBlur = (): void => {
  if (motionBlurRaf !== 0) {
    cancelAnimationFrame(motionBlurRaf);
    motionBlurRaf = 0;
  }
  if (contentLayerRef.value) contentLayerRef.value.style.filter = "";
};

watch(
  () => config.motionBlur,
  (enabled) => {
    if (enabled) startMotionBlur();
    else stopMotionBlur();
  },
);

onMounted(async () => {
  syncViewportSize();
  window.addEventListener("resize", syncViewportSize);
  window.addEventListener("blur", handleWindowBlur);
  /* 初始窗口宽度匹配 fallback 文本宽度 */
  resizeWindow(rawLyricWidth.value);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      hasPainted = true;
    });
  });
  try {
    const [saved, currentMode] = await Promise.all([
      window.api.config.get("dynamicIsland") as Promise<DynamicIslandSettings>,
      window.api.dynamicIsland.getMode(),
    ]);
    Object.assign(config, saved);
    mode.value = currentMode;
  } catch (error) {
    console.error("[dynamic-island] load state failed", error);
  }
  if (config.showSpectrum) {
    window.api.player.setFftEnabled(true).catch(() => {});
  }
  unsubConfig = window.api.dynamicIsland.onConfigChange((next) => {
    const prevShowSpectrum = config.showSpectrum;
    Object.assign(config, next as DynamicIslandSettings);
    if (config.showSpectrum !== prevShowSpectrum) {
      window.api.player.setFftEnabled(config.showSpectrum).catch(() => {});
    }
  });
  unsubMode = window.api.dynamicIsland.onModeChange((next) => {
    mode.value = next;
  });
  unsubCursor = window.api.dynamicIsland.onCursorInside((inside) => {
    hovering.value = inside;
    /* 非遮挡模式下悬停隐藏坨儿时展开 */
    if (inside && hideState.isHidden.value && config.nonOcclusive) {
      hideState.show();
    }
  });
  positionIntervalId = window.setInterval(() => {
    if (isExpanded.value) {
      position.value = getNowPlayingCurrentMs();
    }
  }, 250);
  startMotionBlur();
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", syncViewportSize);
  window.removeEventListener("blur", handleWindowBlur);
  if (positionIntervalId !== null) {
    window.clearInterval(positionIntervalId);
    positionIntervalId = null;
  }
  stopMotionBlur();
  if (config.showSpectrum) {
    window.api.player.setFftEnabled(false).catch(() => {});
  }
  unsubConfig?.();
  unsubConfig = null;
  unsubMode?.();
  unsubMode = null;
  unsubCursor?.();
  unsubCursor = null;
});
</script>

<template>
  <div
    class="root"
    :class="[
      mode === 'snapped' ? 'is-snapped' : 'is-floating',
      {
        'is-hidden': config.nonOcclusive && hovering,
        'is-notch-fusion': notchFusionEnabled,
        'is-expanded': isExpanded,
        'is-island-hidden': hideState.isHidden.value,
        'has-custom-bg': config.backgroundStyle !== 'solid',
      },
    ]"
    :style="rootStyle"
  >
    <svg
      v-if="notchFusionEnabled"
      class="notch-shape"
      :viewBox="`0 0 ${shapeWidth} ${shapeHeight}`"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path :d="notchPath" fill="var(--di-bg)" />
    </svg>
    <GlassBackground
      v-if="config.backgroundStyle !== 'solid'"
      :background-style="config.backgroundStyle"
      :cover-src="track?.cover || ''"
    />
    <!-- 内容层：运动模糊作用对象（不包含背景，避免破坏圆角） -->
    <div ref="contentLayerRef" class="content-layer">
      <!-- Mini 模式内容 -->
      <div
        class="content"
        :style="{
          opacity: Math.max(0, miniAlpha) * contentHideOpacity,
          transform: `translateY(${contentHideTranslateY}px)`,
        }"
        @pointerdown="onContentPointerDown"
      >
        <div class="cover">
          <CoverFlip
            v-if="config.enableCoverFlip"
            :src="track?.cover || DEFAULT_COVER"
            :size="coverSize"
            :radius="coverRadius"
            :default-src="DEFAULT_COVER"
          />
          <img
            v-else
            :src="track?.cover || DEFAULT_COVER"
            alt="cover"
            draggable="false"
            decoding="async"
            @error="($event.target as HTMLImageElement).src = DEFAULT_COVER"
          />
        </div>
        <div class="lyric" :style="{ width: `${lyricWidth}px` }">
          <!-- 旧歌词层：仅在转场期间挂载 -->
          <div
            v-if="lyricTransition.active.value"
            class="lyric-layer lyric-old"
            :style="{
              opacity: lyricTransition.oldOpacity.value,
              filter:
                lyricTransition.oldBlurSigma.value > 0.1
                  ? `blur(${lyricTransition.oldBlurSigma.value.toFixed(2)}px)`
                  : '',
              transform: `translateY(${lyricTransition.oldOffsetY.value.toFixed(2)}px)`,
            }"
          >
            <div
              class="lyric-scale"
              :style="
                notchFusionEnabled
                  ? { width: `${lyricLayoutWidth}px`, transform: `scale(${lyricScale})` }
                  : {}
              "
            >
              <div class="main-line" :class="{ 'is-scrolling': mainTextScrolling }">
                <IslandLyricLine
                  v-if="fittedPrevDisplayLine"
                  :line="fittedPrevDisplayLine"
                  :font-size="fontSize"
                  :font-weight="config.fontWeight"
                  :word-by-word="false"
                />
                <div v-else class="fallback" :style="{ fontSize: `${fontSize}px` }">
                  {{ fittedPrevMainText }}
                </div>
              </div>
              <div
                v-if="prevDisplaySubText"
                class="sub-line"
                :style="{ fontSize: `${subFontSize}px` }"
              >
                {{ fittedPrevSubText }}
              </div>
            </div>
          </div>
          <!-- 新歌词层：始终显示 -->
          <div
            class="lyric-layer lyric-new"
            :style="{
              opacity: lyricTransition.newOpacity.value,
              filter:
                lyricTransition.newBlurSigma.value > 0.1
                  ? `blur(${lyricTransition.newBlurSigma.value.toFixed(2)}px)`
                  : '',
              transform: `translateY(${lyricTransition.newOffsetY.value.toFixed(2)}px)`,
            }"
          >
            <div
              class="lyric-scale"
              :style="
                notchFusionEnabled
                  ? { width: `${lyricLayoutWidth}px`, transform: `scale(${lyricScale})` }
                  : {}
              "
            >
              <div class="main-line" :class="{ 'is-scrolling': mainTextScrolling }">
                <IslandLyricLine
                  v-if="fittedDisplayLine"
                  :line="fittedDisplayLine"
                  :font-size="fontSize"
                  :font-weight="config.fontWeight"
                  :word-by-word="config.wordByWord && !mainTextTruncated"
                />
                <div v-else class="fallback" :style="{ fontSize: `${fontSize}px` }">
                  {{ fittedMainText }}
                </div>
              </div>
              <div v-if="showSubLine" class="sub-line" :style="{ fontSize: `${subFontSize}px` }">
                {{ fittedSubText }}
              </div>
            </div>
          </div>
        </div>
      </div>
      <!-- 展开视图 -->
      <ExpandedView
        v-if="config.enableExpandedView && (isExpanded || progress > 0.001)"
        :track="track"
        :playing="playing"
        :position="position"
        :duration="duration"
        :config="config"
        :current-line="currentLine"
        :is-instrumental="isInstrumental"
        :impulse="layout.impulse"
        :style="{
          opacity: expandedAlpha,
          transform: `translateY(${contentHideTranslateY}px)`,
        }"
        @seek="handleSeek"
        @prev="handlePrev"
        @next="handleNext"
        @toggle-play="handleTogglePlay"
        @interact="
          () => {
            resetTimer();
            hideState.resetActivity();
          }
        "
      />
    </div>
  </div>
</template>

<style scoped>
.root {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  box-sizing: border-box;
  color: var(--di-played);
  border-radius: var(--di-island-radius, 0);
  /* 1px 内边框：白色 12% alpha（对齐 WinIsland render.rs:743-751） */
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  transition:
    border-radius 0.3s cubic-bezier(0.22, 0.61, 0.36, 1),
    opacity 0.2s ease-out;
}
/* 内容层：运动模糊作用对象，撑满 root，不包含背景与边框 */
.content-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
}
.content-layer > * {
  pointer-events: auto;
}
.root.is-hidden {
  opacity: 0;
}
.root.is-island-hidden {
  /* 隐藏态：仅保留 handle 区域可视 */
  cursor: pointer;
}
.root.is-expanded:not(.is-notch-fusion) {
  background: var(--di-bg);
}
.root.is-expanded:not(.is-notch-fusion).has-custom-bg {
  background: transparent;
}
.root.is-notch-fusion {
  width: 100%;
}
.root:not(.is-notch-fusion) {
  background: var(--di-bg);
}
.root:not(.is-notch-fusion).has-custom-bg {
  background: transparent;
}
.root.is-snapped {
  border-radius: 0 0 var(--di-snap-radius) var(--di-snap-radius);
}
.root.is-snapped.is-notch-fusion {
  background: transparent;
  border-radius: 0;
}
.root.is-floating {
  background: var(--di-bg);
  border-radius: var(--di-island-radius, 999px);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.root.is-floating.has-custom-bg {
  background: transparent;
}
.notch-shape {
  position: absolute;
  top: 0;
  left: 50%;
  width: var(--di-shape-width);
  height: 100%;
  transform: translateX(-50%);
  pointer-events: none;
}
.content {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: var(--di-gap);
  min-width: 0;
  width: 100%;
  height: 100%;
  padding: 0 var(--di-padx);
  box-sizing: border-box;
}
.root.is-notch-fusion .content {
  width: 100%;
}
.root.is-snapped.is-notch-fusion .content {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: var(--di-fusion-content-width);
  height: var(--di-content-height);
  transform: translateX(-50%);
}
.cover {
  flex: 0 0 auto;
  width: var(--di-cover);
  height: var(--di-cover);
  border-radius: var(--di-cover-radius);
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  pointer-events: none;
}
.lyric {
  position: relative;
  flex: 0 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  white-space: nowrap;
}
.lyric-layer {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  will-change: opacity, filter, transform;
}
.lyric-new {
  position: relative;
}
.lyric-scale {
  flex: 0 0 auto;
  min-width: 0;
  transform-origin: center center;
}
.main-line {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  width: 100%;
  overflow: hidden;
}
.main-line.is-scrolling {
  justify-content: flex-start;
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 8px,
    #000 calc(100% - 8px),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 8px,
    #000 calc(100% - 8px),
    transparent 100%
  );
}
.main-line.is-scrolling .fallback {
  animation: di-marquee 8s linear infinite;
  padding-right: 32px;
}
@keyframes di-marquee {
  0%,
  10% {
    transform: translateX(0);
  }
  90%,
  100% {
    transform: translateX(calc(-100% + var(--di-lyric-slot, 0px)));
  }
}
.fallback {
  max-width: 100%;
  overflow: hidden;
  color: var(--di-played);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sub-line {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  color: var(--di-played);
  opacity: 0.65;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.root.is-expanded {
  cursor: default;
}
.root.is-expanded .content {
  pointer-events: none;
}
</style>
