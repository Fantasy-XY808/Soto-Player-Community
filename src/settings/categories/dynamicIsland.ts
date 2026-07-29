import type { SettingCategory, SettingSection } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import { isMac } from "@/utils/config";
import IconLucideSquareDot from "~icons/lucide/square-dot";

const dynamicIslandSection: SettingSection = {
  id: "dynamicIsland",
  tag: { text: "Beta", type: "info" },
  items: [
    {
      key: "dynamicIslandEnabled",
      type: "switch",
      binding: { store: "settings", path: "isDynamicIslandOpen" },
      defaultValue: false,
    },
    {
      key: "dynamicIslandScale",
      type: "slider",
      binding: { store: "settings", path: "system.dynamicIsland.scale" },
      min: 0.5,
      max: 2,
      step: 0.05,
      defaultValue: 1,
      marks: { 0.5: "50%", 1: "100%", 2: "200%" },
    },
    {
      key: "dynamicIslandFontWeight",
      type: "slider",
      binding: { store: "settings", path: "system.dynamicIsland.fontWeight" },
      min: 100,
      max: 900,
      step: 100,
      defaultValue: 500,
      marks: { 100: "100", 500: "500", 900: "900" },
    },
    {
      key: "dynamicIslandWordByWord",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.wordByWord" },
      defaultValue: true,
    },
    {
      key: "dynamicIslandDoubleLine",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.doubleLine" },
      defaultValue: false,
    },
    {
      key: "dynamicIslandShowTranslation",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.showTranslation" },
      defaultValue: false,
    },
    {
      key: "dynamicIslandPlayedColor",
      type: "color",
      binding: { store: "settings", path: "system.dynamicIsland.playedColor" },
      defaultValue: "rgba(255, 255, 255, 1)",
      showAlpha: false,
    },
    {
      key: "dynamicIslandUnplayedColor",
      type: "color",
      binding: { store: "settings", path: "system.dynamicIsland.unplayedColor" },
      defaultValue: "rgba(255, 255, 255, 0.5)",
    },
    {
      key: "dynamicIslandBackgroundColor",
      type: "color",
      binding: { store: "settings", path: "system.dynamicIsland.backgroundColor" },
      defaultValue: "rgba(0, 0, 0, 1)",
    },
    {
      key: "dynamicIslandAlwaysOnTop",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.alwaysOnTop" },
      defaultValue: true,
    },
    ...(isMac
      ? [
          {
            key: "dynamicIslandNotchFusion",
            type: "switch" as const,
            binding: { store: "settings" as const, path: "system.dynamicIsland.notchFusion" },
            defaultValue: false,
          },
        ]
      : []),
    {
      key: "dynamicIslandSnapCentered",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.snapCentered" },
      defaultValue: true,
      disabled: () => useSettingsStore().system.dynamicIsland.notchFusion,
      childrenCondition: () =>
        !useSettingsStore().system.dynamicIsland.snapCentered &&
        !useSettingsStore().system.dynamicIsland.notchFusion,
      children: [
        {
          key: "dynamicIslandHorizontalOffset",
          type: "slider",
          binding: { store: "settings", path: "system.dynamicIsland.horizontalOffset" },
          min: -500,
          max: 500,
          step: 10,
          defaultValue: 0,
          marks: { "-500": "-500", 0: "0", 500: "500" },
          advanced: true,
        },
      ],
    },
    {
      key: "dynamicIslandNonOcclusive",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.nonOcclusive" },
      defaultValue: false,
      advanced: true,
    },
    {
      key: "dynamicIslandShowSpectrum",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.showSpectrum" },
      defaultValue: true,
      children: [
        {
          key: "dynamicIslandSpectrumStyle",
          type: "select",
          binding: { store: "settings", path: "system.dynamicIsland.spectrumStyle" },
          options: [
            { value: "gradient", labelKey: "settings.dynamicIslandSpectrumStyle.gradient" },
            { value: "solid", labelKey: "settings.dynamicIslandSpectrumStyle.solid" },
            { value: "minimal", labelKey: "settings.dynamicIslandSpectrumStyle.minimal" },
          ],
          defaultValue: "gradient",
        },
      ],
    },
    {
      key: "dynamicIslandEnableExpandedView",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.enableExpandedView" },
      defaultValue: true,
      childrenCondition: () => useSettingsStore().system.dynamicIsland.enableExpandedView,
      children: [
        {
          key: "dynamicIslandExpandedTimeout",
          type: "slider",
          binding: { store: "settings", path: "system.dynamicIsland.expandedTimeout" },
          min: 3,
          max: 30,
          step: 1,
          defaultValue: 8,
          marks: { 3: "3s", 8: "8s", 15: "15s", 30: "30s" },
          advanced: true,
        },
      ],
    },
    {
      key: "dynamicIslandBackgroundStyle",
      type: "select",
      binding: { store: "settings", path: "system.dynamicIsland.backgroundStyle" },
      options: [
        { value: "solid", labelKey: "settings.dynamicIslandBackgroundStyle.solid" },
        { value: "glass", labelKey: "settings.dynamicIslandBackgroundStyle.glass" },
        { value: "mica", labelKey: "settings.dynamicIslandBackgroundStyle.mica" },
        { value: "dynamic", labelKey: "settings.dynamicIslandBackgroundStyle.dynamic" },
      ],
      defaultValue: "solid",
    },
    {
      key: "dynamicIslandWidthMode",
      type: "select",
      binding: { store: "settings", path: "system.dynamicIsland.widthMode" },
      options: [
        { value: "adaptive", labelKey: "settings.dynamicIslandWidthMode.adaptive" },
        { value: "fixed", labelKey: "settings.dynamicIslandWidthMode.fixed" },
      ],
      defaultValue: "adaptive",
      childrenCondition: () => useSettingsStore().system.dynamicIsland.widthMode === "fixed",
      children: [
        {
          key: "dynamicIslandFixedWidth",
          type: "slider",
          binding: { store: "settings", path: "system.dynamicIsland.fixedWidth" },
          min: 280,
          max: 600,
          step: 10,
          defaultValue: 360,
          marks: { 280: "280", 360: "360", 480: "480", 600: "600" },
          advanced: true,
        },
      ],
    },
    {
      key: "dynamicIslandMaxWidth",
      type: "slider",
      binding: { store: "settings", path: "system.dynamicIsland.maxWidth" },
      min: 320,
      max: 720,
      step: 20,
      defaultValue: 480,
      marks: { 320: "320", 480: "480", 600: "600", 720: "720" },
      childrenCondition: () => useSettingsStore().system.dynamicIsland.widthMode === "adaptive",
      advanced: true,
    },
    {
      key: "dynamicIslandOverflowMode",
      type: "select",
      binding: { store: "settings", path: "system.dynamicIsland.overflowMode" },
      options: [
        { value: "truncate", labelKey: "settings.dynamicIslandOverflowMode.truncate" },
        { value: "scroll", labelKey: "settings.dynamicIslandOverflowMode.scroll" },
      ],
      defaultValue: "truncate",
    },
    {
      key: "dynamicIslandEnableCoverFlip",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.enableCoverFlip" },
      defaultValue: true,
    },
    {
      key: "dynamicIslandMotionBlur",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.motionBlur" },
      defaultValue: true,
    },
    {
      key: "dynamicIslandAutoHide",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.autoHide" },
      defaultValue: false,
      childrenCondition: () => useSettingsStore().system.dynamicIsland.autoHide,
      children: [
        {
          key: "dynamicIslandAutoHideDelay",
          type: "slider",
          binding: { store: "settings", path: "system.dynamicIsland.autoHideDelay" },
          min: 3,
          max: 60,
          step: 1,
          defaultValue: 5,
          marks: { 3: "3s", 5: "5s", 15: "15s", 30: "30s", 60: "60s" },
          advanced: true,
        },
      ],
    },
    // macOS 全屏为独占空间语义，无需此抑制；仅 Windows/Linux 显示
    ...(!isMac
      ? [
          {
            key: "dynamicIslandSuppressFullscreen",
            type: "switch" as const,
            binding: { store: "settings" as const, path: "system.dynamicIsland.suppressFullscreen" },
            defaultValue: true,
            advanced: true,
          },
        ]
      : []),
    {
      key: "dynamicIslandAutoStart",
      type: "switch",
      binding: { store: "settings", path: "system.dynamicIsland.autoStart" },
      defaultValue: false,
    },
  ],
};

const dynamicIslandCategory: SettingCategory = {
  id: "dynamicIsland",
  icon: IconLucideSquareDot,
  sections: [dynamicIslandSection],
};

export default dynamicIslandCategory;
