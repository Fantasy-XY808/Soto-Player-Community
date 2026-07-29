/**
 * 12 个全局 Registry 单例
 */
import { ExtensionRegistry } from "./registry";
import type {
  WindowModeDescriptor,
  LayoutProfile,
  LyricsEngineDescriptor,
  LyricsEffectDescriptor,
  BackgroundOverlayDescriptor,
  SpectrumStyleDescriptor,
  LyricsCardStyleDescriptor,
  StatsWidgetDescriptor,
  MusicSourceDescriptor,
  LyricsSourceDescriptor,
  TranslationProviderDescriptor,
  TransliterationProviderDescriptor,
} from "../types/plugin-extensions";

export const WindowModeRegistry = new ExtensionRegistry<WindowModeDescriptor>();
export const LayoutProfileRegistry = new ExtensionRegistry<LayoutProfile>();
export const LyricsEngineRegistry = new ExtensionRegistry<LyricsEngineDescriptor>();
export const LyricsEffectRegistry = new ExtensionRegistry<LyricsEffectDescriptor>();
export const BackgroundOverlayRegistry = new ExtensionRegistry<BackgroundOverlayDescriptor>();
export const SpectrumStyleRegistry = new ExtensionRegistry<SpectrumStyleDescriptor>();
export const LyricsCardStyleRegistry = new ExtensionRegistry<LyricsCardStyleDescriptor>();
export const StatsWidgetRegistry = new ExtensionRegistry<StatsWidgetDescriptor>();
export const MusicSourceRegistry = new ExtensionRegistry<MusicSourceDescriptor>();
export const LyricsSourceRegistry = new ExtensionRegistry<LyricsSourceDescriptor>();
export const TranslationProviderRegistry = new ExtensionRegistry<TranslationProviderDescriptor>();
export const TransliterationProviderRegistry = new ExtensionRegistry<TransliterationProviderDescriptor>();

/** 所有 12 个 Registry 的列表（用于扩展点查看面板与热更改批量操作） */
export const ALL_REGISTRIES: ReadonlyArray<{ name: string; registry: ExtensionRegistry<unknown> }> = [
  { name: "WindowMode", registry: WindowModeRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "LayoutProfile", registry: LayoutProfileRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "LyricsEngine", registry: LyricsEngineRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "LyricsEffect", registry: LyricsEffectRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "BackgroundOverlay", registry: BackgroundOverlayRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "SpectrumStyle", registry: SpectrumStyleRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "LyricsCardStyle", registry: LyricsCardStyleRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "StatsWidget", registry: StatsWidgetRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "MusicSource", registry: MusicSourceRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "LyricsSource", registry: LyricsSourceRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "TranslationProvider", registry: TranslationProviderRegistry as unknown as ExtensionRegistry<unknown> },
  { name: "TransliterationProvider", registry: TransliterationProviderRegistry as unknown as ExtensionRegistry<unknown> },
];
