import type { EqualizerBand, SystemConfig } from "../types/settings";
import { EqualizerFilterType } from "../types/settings";
import { defaultPluginsConfig } from "./plugin-api";
import { defaultHotkeyConfig } from "./hotkeys";

/**
 * 灵动岛基准高度（缩放比例 = 1 时的物理像素，等于"主行高度")
 * 主行高度 = DYNAMIC_ISLAND_BASE_HEIGHT * scale
 * 双行模式下窗口最终高度 = 主行高度 + 副行高度
 * 主进程按渲染端上报的最终高度 setBounds
 */
export const DYNAMIC_ISLAND_BASE_HEIGHT = 40;

/** 默认 10 频段中心频率（Hz）—— 与原固定 EQ 频段保持一致 */
export const EQ_DEFAULT_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

/** 默认 Q 值（与原 EQ 行为一致：约 1.4 octave 带宽） */
export const EQ_DEFAULT_Q = 1.4;

/** 构造默认 10 频段（全部 0dB、Peaking） */
const buildDefaultBands = (): EqualizerBand[] =>
  EQ_DEFAULT_FREQS.map((freq) => ({
    freq,
    q: EQ_DEFAULT_Q,
    gain: 0,
    filterType: EqualizerFilterType.Peaking,
  }));

/** 默认配置 */
export const defaultSystemConfig: SystemConfig = {
  player: {
    autoPlay: false,
    rememberLastTrack: true,
    fadeEnabled: true,
    fadeDuration: 200,
    outputDevice: null,
    volume: 1,
    loudnessNormalization: false,
    equalizer: {
      enabled: false,
      preset: "flat",
      bands: buildDefaultBands(),
      preamp: 0,
      bassBoost: 0,
      trebleBoost: 0,
      surround: 1.0,
      bypass: false,
      customPresets: [],
    },
    audioSuperResolution: {
      enabled: true,
      backend: 0,
      params: {
        hpFreq: 3500,
        hpQ: 0.7,
        drive: 4.5,
        h2Drive: 0.6,
        h2Mix: 0.18,
        wetMix: 0.55,
        inputLimit: 1.2,
        bypass: false,
      },
    },
    bassEnhancer: {
      enabled: true,
      freq: 80,
      gainDb: 10.0,
      q: 0.7,
      harmonicsMix: 0.45,
      bypass: false,
    },
    stereoWidener: {
      enabled: true,
      width: 1.5,
      crossFeed: 0.15,
      haasEnabled: true,
      bypass: false,
    },
    loudnessNormalizer: {
      enabled: true,
      targetLufs: -10.0,
      maxGainDb: 9.0,
      bypass: false,
    },
    neuralUpsample: {
      enabled: false,
      backend: 0,
      modelPath: null,
      params: {
        inputGainDb: 0.0,
        wetMix: 0.5,
        bypass: false,
      },
    },
    spatialAudio: {
      enabled: true,
      width: 1.6,
      bassGainDb: 8.0,
      bassFreq: 65,
      superResDrive: 5.5,
      superResWetMix: 0.6,
      bypass: false,
    },
    lyricOffsets: {},
    fftEqualLoudness: true,
  },
  media: {
    systemMediaControls: true,
    discord: {
      enabled: false,
      showWhenPaused: false,
      displayMode: "name",
    },
  },
  library: {
    scanDirs: [],
  },
  desktopLyric: {
    fontSize: 24,
    fontWeight: 600,
    fontFamily: "",
    showTranslation: true,
    doubleLine: true,
    align: "center",
    wordByWord: true,
    autoGenerateWordByWord: true,
    playedColor: "rgb(254, 121, 113)",
    unplayedColor: "rgb(255, 255, 255)",
    strokeColor: "rgba(0, 0, 0, 0.5)",
    backgroundMask: false,
    backgroundMaskColor: "rgba(0, 0, 0, 0.3)",
    alwaysShowSongInfo: false,
    limitBounds: false,
    animation: true,
    alwaysOnTop: true,
    locked: false,
  },
  dynamicIsland: {
    scale: 1,
    fontWeight: 500,
    fontFamily: "",
    wordByWord: true,
    playedColor: "rgba(255, 255, 255, 1)",
    unplayedColor: "rgba(255, 255, 255, 0.85)",
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
  },
  taskbarLyric: {
    position: "auto",
    autoMaxWidth: true,
    maxWidth: 400,
    leftMargin: 0,
    rightMargin: 0,
    colorMode: "taskbar",
    doubleLine: true,
    showTranslation: true,
    showCover: true,
    wordByWord: true,
    fontSize: 14,
    fontFamily: "",
    showSpectrum: true,
    spectrumSensitivity: 1.0,
    spectrumSmoothing: 0.3,
    spectrumHoverBarCount: 7,
  },
  lyric: {
    enableOnlineTTMLLyric: false,
    amllDbServer: "https://amlldb.bikonoo.com/%p/%s.ttml",
  },
  localLyric: {
    enableLocalTTMLOverride: false,
    repoDir: "",
  },
  cache: {
    dir: null,
    songCache: {
      enabled: false,
      sizeLimitGb: 10,
    },
  },
  download: {
    enabled: false,
    dir: null,
    quality: "lossless",
    usePlaybackForDownload: false,
    fileTemplate: "{artist} - {title}",
    folderScheme: "none",
    overwritePolicy: "rename",
    embedCover: true,
    embedMeta: true,
    embedLyric: true,
    writeLrc: false,
    saveTtml: false,
    lyricFileFormat: "enhanced-lrc",
  },
  streaming: {
    enabled: true,
  },
  lastfm: {
    enabled: false,
    scrobble: true,
    nowPlaying: true,
    loveSync: true,
  },
  externalApi: {
    enabled: false,
    wsEnabled: false,
    allowLan: false,
    port: 14558,
  },
  listenTogether: {
    enabled: true,
    port: 23333,
    progressMode: "manual",
    progressInterval: 2000,
    queueMode: "currentAndNext",
    autoReconnect: true,
    lastHostUrl: "",
    allowClientPause: true,
    allowClientSkip: true,
    allowClientEditQueue: true,
    easyTierEnabled: true,
    easyTierNetworkName: "soto-player",
    easyTierNetworkSecret: "",
  },
  update: {
    autoCheck: true,
  },
  automix: {
    enabled: false,
    crossfadeMs: 8000,
    bpmTolerance: 8,
    keyMatchMode: "camelot",
    strategy: "bpmKey",
    candidatePoolSize: 10,
    crossfadeEnabled: true,
    autoAnalyze: true,
    autoRecommend: false,
  },
  system: {
    rememberWindowState: true,
    taskbarProgress: true,
    uiZoom: 100,
    onboardingCompleted: false,
    neteaseRealIp: false,
    neteaseScrobbleEnabled: false,
    neteaseScrobbleMode: "ncbl",
    registerOrpheusProtocol: false,
    proxy: {
      protocol: "off",
      host: "",
      port: 7890,
      username: "",
      password: "",
    },
    preventSleep: false,
    songUnlockServer: [
      { key: "netease", enabled: true },
      { key: "kuwo", enabled: true },
      { key: "bodian", enabled: false },
    ],
  },
  windowStates: {
    main: {
      width: 1280,
      height: 800,
      x: null,
      y: null,
      maximized: false,
    },
    desktopLyric: {
      width: 800,
      height: 200,
      x: null,
      y: null,
      visible: false,
    },
    dynamicIsland: {
      mode: "snapped",
      x: null,
      y: null,
      visible: false,
    },
    taskbarLyric: {
      visible: false,
    },
  },
  plugins: defaultPluginsConfig,
  hotkeys: defaultHotkeyConfig,
};