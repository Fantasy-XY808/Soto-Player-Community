import { test } from "node:test";
import assert from "node:assert/strict";
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
} from "../../shared/types/plugin-extensions.js";

test("12 扩展点接口可被引用（编译期检查）", () => {
  const _a: WindowModeDescriptor = {} as WindowModeDescriptor;
  const _b: LayoutProfile = {} as LayoutProfile;
  const _c: LyricsEngineDescriptor = {} as LyricsEngineDescriptor;
  const _d: LyricsEffectDescriptor = {} as LyricsEffectDescriptor;
  const _e: BackgroundOverlayDescriptor = {} as BackgroundOverlayDescriptor;
  const _f: SpectrumStyleDescriptor = {} as SpectrumStyleDescriptor;
  const _g: LyricsCardStyleDescriptor = {} as LyricsCardStyleDescriptor;
  const _h: StatsWidgetDescriptor = {} as StatsWidgetDescriptor;
  const _i: MusicSourceDescriptor = {} as MusicSourceDescriptor;
  const _j: LyricsSourceDescriptor = {} as LyricsSourceDescriptor;
  const _k: TranslationProviderDescriptor = {} as TranslationProviderDescriptor;
  const _l: TransliterationProviderDescriptor = {} as TransliterationProviderDescriptor;
  assert.ok(_a && _b && _c && _d && _e && _f && _g && _h && _i && _j && _k && _l);
});
