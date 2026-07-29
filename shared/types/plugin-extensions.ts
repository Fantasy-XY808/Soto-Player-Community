/**
 * 12 个扩展点接口定义
 *
 * 每个扩展点对应一个 ExtensionRegistry<T>，插件可注册自定义实现。
 */

import type { Disposable } from "../extensions/disposable";
import type { LyricLine } from "./lyrics";
import type { Track } from "./player";

// ============================================================
// 1. WindowModeRegistry
// ============================================================

export type LyricsWindowMode =
  | "standard"
  | "narrow"
  | "fullscreen"
  | "desktop"
  | "docked"
  | "taskbar"
  | "wallpaper"
  | "dynamicIsland";

export interface WindowModeDescriptor {
  mode: LyricsWindowMode;
  label: string;
  icon?: string;
  windowsOnly?: boolean;
  apply: (windowId: string) => Promise<Disposable>;
}

// ============================================================
// 2. LayoutProfileRegistry
// ============================================================

export type ComponentType =
  | "None"
  | "Lyrics"
  | "LyricsCard"
  | "AlbumArt"
  | "SongTitle"
  | "SongArtist"
  | "SongAlbum"
  | "Spectrum"
  | "StatsWidget";

export interface ComponentPlacement {
  componentType: ComponentType;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  marginLeft: number;
  marginTop: number;
  marginRight: number;
  marginBottom: number;
  horizontalAlignment: "Stretch" | "Center" | "Left" | "Right";
  verticalAlignment: "Stretch" | "Center" | "Top" | "Bottom";
  width: number;
  height: number;
}

export interface LayoutProfile {
  id: string;
  mode: number;
  name: string;
  rowDefinitions: string[];
  columnDefinitions: string[];
  rowSpacing: number;
  columnSpacing: number;
  paddingLeft: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  placements: ComponentPlacement[];
}

// ============================================================
// 3. LyricsEngineRegistry
// ============================================================

export interface LyricsEngineContext {
  canvas: HTMLCanvasElement | null;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

export interface LyricsEngineDescriptor {
  id: string;
  label: string;
  create: (context: LyricsEngineContext) => LyricsEngine;
}

export interface LyricsEngine {
  setLines(lines: LyricLine[]): void;
  setPosition(ms: number): void;
  setStyle(style: Partial<LyricsEngineContext>): void;
  render(): void;
  dispose(): void;
}

// ============================================================
// 4. LyricsEffectRegistry
// ============================================================

export type LyricsEffectScope = "line" | "char";

export interface LyricsEffectDescriptor {
  id: string;
  label: string;
  scope: LyricsEffectScope;
  defaultParams: Record<string, number | boolean | string>;
  apply: (ctx: LyricsEffectContext, params: Record<string, unknown>) => LyricsEffectResult;
}

export interface LyricsEffectContext {
  lineIndex: number;
  charIndex?: number;
  isPlaying: boolean;
  distanceFactor: number;
  bassEnergy: number;
  currentPositionMs: number;
}

export interface LyricsEffectResult {
  transform?: string;
  filter?: string;
  opacity?: number;
  textShadow?: string;
  extraCss?: Record<string, string>;
}

// ============================================================
// 5. BackgroundOverlayRegistry
// ============================================================

export interface BackgroundOverlayDescriptor {
  id: string;
  label: string;
  create: (container: HTMLElement) => BackgroundOverlay;
}

export interface BackgroundOverlay {
  setCover?(coverUrl: string): void;
  setPalette?(palette: string[]): void;
  setSpectrum?(data: Uint8Array): void;
  setBassEnergy?(energy: number): void;
  dispose(): void;
}

// ============================================================
// 6. SpectrumStyleRegistry
// ============================================================

export interface SpectrumStyleDescriptor {
  id: string;
  label: string;
  render: (ctx: CanvasRenderingContext2D, data: Uint8Array, options: SpectrumRenderOptions) => void;
}

export interface SpectrumRenderOptions {
  width: number;
  height: number;
  barCount: number;
  sensitivity: number;
  glow: boolean;
  color: string;
}

// ============================================================
// 7. LyricsCardStyleRegistry
// ============================================================

export interface LyricsCardStyleDescriptor {
  id: string;
  label: string;
  thumbnail?: string;
  fontFamily: string;
  render: (container: HTMLElement, data: LyricsCardData) => Disposable;
}

export interface LyricsCardData {
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  accentColor?: string;
  lyrics: LyricLine[];
  currentPositionMs: number;
}

// ============================================================
// 8. StatsWidgetRegistry
// ============================================================

export interface StatsWidgetDescriptor {
  id: string;
  label: string;
  defaultRowSpan: number;
  defaultColumnSpan: number;
  component: unknown;
}

// ============================================================
// 9. MusicSourceRegistry
// ============================================================

export interface MusicSourceDescriptor {
  id: string;
  label: string;
  search?: (keyword: string, page: number) => Promise<{ total: number; items: Track[] }>;
  resolveUrl: (track: Track, quality?: string) => Promise<string>;
  getLyric?: (track: Track) => Promise<string | null>;
}

// ============================================================
// 10. LyricsSourceRegistry
// ============================================================

export interface LyricsSourceDescriptor {
  id: string;
  label: string;
  search: (query: { title: string; artist: string; album?: string; duration?: number }) => Promise<LyricLine[] | null>;
}

// ============================================================
// 11. TranslationProviderRegistry
// ============================================================

export interface TranslationProviderDescriptor {
  id: string;
  label: string;
  translate: (text: string, targetLangCode: string) => Promise<string | null>;
}

// ============================================================
// 12. TransliterationProviderRegistry
// ============================================================

export interface TransliterationProviderDescriptor {
  id: string;
  label: string;
  transliterate: (text: string, targetLangCode: string) => Promise<string | null>;
}
