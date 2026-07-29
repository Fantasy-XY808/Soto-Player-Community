import type { SettingCategory, SettingSection } from "@/types/settings-schema";
import IconLucideMonitor from "~icons/lucide/monitor";

const desktopLyricSection: SettingSection = {
  id: "desktopLyric",
  tag: { text: "Beta", type: "info" },
  items: [
    {
      key: "desktopLyricEnabled",
      type: "switch",
      binding: { store: "settings", path: "isDesktopLyricOpen" },
      defaultValue: false,
    },
    {
      key: "desktopLyricFontSize",
      type: "select",
      binding: { store: "settings", path: "system.desktopLyric.fontSize" },
      defaultValue: 24,
      options: Array.from({ length: 96 - 20 + 1 }, (_, i) => {
        const n = 20 + i;
        return { value: n, label: `${n} px` };
      }),
    },
    {
      key: "desktopLyricFontWeight",
      type: "slider",
      binding: { store: "settings", path: "system.desktopLyric.fontWeight" },
      min: 100,
      max: 900,
      step: 100,
      defaultValue: 600,
      marks: { 100: "100", 400: "400", 700: "700", 900: "900" },
    },
    {
      key: "desktopLyricDoubleLine",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.doubleLine" },
      defaultValue: true,
    },
    {
      key: "desktopLyricAlign",
      type: "select",
      binding: { store: "settings", path: "system.desktopLyric.align" },
      options: [
        { value: "left", labelKey: "settings.desktopLyricAlign.left" },
        { value: "center", labelKey: "settings.desktopLyricAlign.center" },
        { value: "right", labelKey: "settings.desktopLyricAlign.right" },
        { value: "justify", labelKey: "settings.desktopLyricAlign.justify" },
      ],
      defaultValue: "center",
    },
    {
      key: "desktopLyricWordByWord",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.wordByWord" },
      defaultValue: true,
    },
    {
      key: "desktopLyricAutoGenerateWordByWord",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.autoGenerateWordByWord" },
      defaultValue: true,
    },
    {
      key: "desktopLyricShowTranslation",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.showTranslation" },
      defaultValue: true,
    },
    {
      key: "desktopLyricPlayedColor",
      type: "color",
      binding: { store: "settings", path: "system.desktopLyric.playedColor" },
      defaultValue: "#ffffff",
      showAlpha: false,
    },
    {
      key: "desktopLyricUnplayedColor",
      type: "color",
      binding: { store: "settings", path: "system.desktopLyric.unplayedColor" },
      defaultValue: "#7d7d7d",
      showAlpha: false,
    },
    {
      key: "desktopLyricStrokeColor",
      type: "color",
      binding: { store: "settings", path: "system.desktopLyric.strokeColor" },
      defaultValue: "rgba(0, 0, 0, 0.5)",
    },
    {
      key: "desktopLyricBackgroundMask",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.backgroundMask" },
      defaultValue: false,
      children: [
        {
          key: "desktopLyricBackgroundMaskColor",
          type: "color",
          binding: { store: "settings", path: "system.desktopLyric.backgroundMaskColor" },
          defaultValue: "rgba(0, 0, 0, 0.3)",
        },
      ],
    },
    {
      key: "desktopLyricAlwaysShowSongInfo",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.alwaysShowSongInfo" },
      defaultValue: false,
    },
    {
      key: "desktopLyricAnimation",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.animation" },
      defaultValue: true,
    },
    {
      key: "desktopLyricLimitBounds",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.limitBounds" },
      defaultValue: false,
      advanced: true,
    },
    {
      key: "desktopLyricAlwaysOnTop",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.alwaysOnTop" },
      defaultValue: true,
    },
    {
      key: "desktopLyricLocked",
      type: "switch",
      binding: { store: "settings", path: "system.desktopLyric.locked" },
      defaultValue: false,
    },
  ],
};

const desktopLyricCategory: SettingCategory = {
  id: "desktopLyric",
  icon: IconLucideMonitor,
  sections: [desktopLyricSection],
};

export default desktopLyricCategory;
