import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WindowModeRegistry,
  LayoutProfileRegistry,
  LyricsEngineRegistry,
  LyricsEffectRegistry,
  BackgroundOverlayRegistry,
  SpectrumStyleRegistry,
  LyricsCardStyleRegistry,
  StatsWidgetRegistry,
  MusicSourceRegistry,
  LyricsSourceRegistry,
  TranslationProviderRegistry,
  TransliterationProviderRegistry,
  ALL_REGISTRIES,
} from "../../shared/extensions/registries.js";

test("12 个 Registry 单例均可访问", () => {
  assert.ok(WindowModeRegistry);
  assert.ok(LayoutProfileRegistry);
  assert.ok(LyricsEngineRegistry);
  assert.ok(LyricsEffectRegistry);
  assert.ok(BackgroundOverlayRegistry);
  assert.ok(SpectrumStyleRegistry);
  assert.ok(LyricsCardStyleRegistry);
  assert.ok(StatsWidgetRegistry);
  assert.ok(MusicSourceRegistry);
  assert.ok(LyricsSourceRegistry);
  assert.ok(TranslationProviderRegistry);
  assert.ok(TransliterationProviderRegistry);
});

test("ALL_REGISTRIES 包含 12 个条目", () => {
  assert.equal(ALL_REGISTRIES.length, 12);
});

test("各 Registry 初始 resolve() 返回数组", () => {
  assert.ok(Array.isArray(WindowModeRegistry.resolve()));
  assert.ok(Array.isArray(LayoutProfileRegistry.resolve()));
  assert.ok(Array.isArray(LyricsEngineRegistry.resolve()));
});
