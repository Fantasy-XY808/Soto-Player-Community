import type { SettingCategory, SettingSection } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import IconLucidePanelBottom from "~icons/lucide/panel-bottom";

/** Win 平台限定 */
const taskbarLyricSection: SettingSection = {
  id: "taskbarLyric",
  tag: { text: "Beta", type: "info" },
  items: [
    {
      key: "taskbarLyricEnabled",
      type: "switch",
      binding: { store: "settings", path: "isTaskbarLyricOpen" },
      defaultValue: false,
    },
    {
      key: "taskbarLyricPosition",
      type: "select",
      binding: { store: "settings", path: "system.taskbarLyric.position" },
      options: [
        { value: "auto", labelKey: "settings.taskbarLyricPosition.auto" },
        { value: "left", labelKey: "settings.taskbarLyricPosition.left" },
        { value: "right", labelKey: "settings.taskbarLyricPosition.right" },
      ],
      defaultValue: "auto",
    },
    {
      key: "taskbarLyricSnap",
      type: "select",
      binding: { store: "settings", path: "system.taskbarLyric.snap" },
      options: [
        { value: "cover", labelKey: "settings.taskbarLyricSnap.cover" },
        { value: "app", labelKey: "settings.taskbarLyricSnap.app" },
      ],
      defaultValue: "cover",
    },
    {
      key: "taskbarLyricAutoMaxWidth",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.autoMaxWidth" },
      defaultValue: true,
      childrenCondition: () => useSettingsStore().system.taskbarLyric.autoMaxWidth === false,
      children: [
        {
              key: "taskbarLyricMaxWidth",
              type: "slider",
              binding: { store: "settings", path: "system.taskbarLyric.maxWidth" },
              min: 200,
              max: 800,
              step: 20,
              defaultValue: 400,
              marks: { 200: "200", 400: "400", 800: "800" },
              advanced: true,
            },
      ],
    },
    {
      key: "taskbarLyricLeftMargin",
      type: "number",
      binding: { store: "settings", path: "system.taskbarLyric.leftMargin" },
      min: 0,
      max: 500,
      defaultValue: 0,
      advanced: true,
    },
    {
      key: "taskbarLyricRightMargin",
      type: "number",
      binding: { store: "settings", path: "system.taskbarLyric.rightMargin" },
      min: 0,
      max: 500,
      defaultValue: 0,
      advanced: true,
    },
    {
      key: "taskbarLyricColorMode",
      type: "select",
      binding: { store: "settings", path: "system.taskbarLyric.colorMode" },
      options: [
        { value: "taskbar", labelKey: "settings.taskbarLyricColorMode.taskbar" },
        { value: "taskbarInverse", labelKey: "settings.taskbarLyricColorMode.taskbarInverse" },
        { value: "light", labelKey: "settings.taskbarLyricColorMode.light" },
        { value: "dark", labelKey: "settings.taskbarLyricColorMode.dark" },
      ],
      defaultValue: "taskbar",
      advanced: true,
    },
    {
      key: "taskbarLyricFontSize",
      type: "slider",
      binding: { store: "settings", path: "system.taskbarLyric.fontSize" },
      min: 12,
      max: 20,
      step: 1,
      defaultValue: 14,
      marks: { 12: "12", 14: "14", 17: "17", 20: "20" },
    },
    {
      key: "taskbarLyricShowCover",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.showCover" },
      defaultValue: true,
      childrenCondition: () => useSettingsStore().system.taskbarLyric.showCover,
      children: [
        {
          key: "taskbarLyricCoverSize",
          type: "slider",
          binding: { store: "settings", path: "system.taskbarLyric.coverSize" },
          min: 24,
          max: 64,
          step: 2,
          defaultValue: 40,
          marks: { 24: "24", 40: "40", 64: "64" },
          advanced: true,
        },
      ],
    },
    {
      key: "taskbarLyricWordByWord",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.wordByWord" },
      defaultValue: true,
    },
    {
      key: "taskbarLyricDoubleLine",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.doubleLine" },
      defaultValue: true,
    },
    {
      key: "taskbarLyricShowTranslation",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.showTranslation" },
      defaultValue: true,
    },
    {
      key: "taskbarLyricShowSpectrum",
      type: "switch",
      binding: { store: "settings", path: "system.taskbarLyric.showSpectrum" },
      defaultValue: true,
      children: [
        {
          key: "taskbarLyricSpectrumSensitivity",
          type: "slider",
          binding: { store: "settings", path: "system.taskbarLyric.spectrumSensitivity" },
          min: 0.5,
          max: 3,
          step: 0.1,
          defaultValue: 1,
          marks: { 0.5: "0.5", 1: "1", 2: "2", 3: "3" },
          advanced: true,
        },
        {
          key: "taskbarLyricSpectrumSmoothing",
          type: "slider",
          binding: { store: "settings", path: "system.taskbarLyric.spectrumSmoothing" },
          min: 0,
          max: 0.9,
          step: 0.05,
          defaultValue: 0.5,
          marks: { 0: "0", 0.5: "0.5", 0.9: "0.9" },
          advanced: true,
        },
        {
          key: "taskbarLyricSpectrumHoverBarCount",
          type: "slider",
          binding: { store: "settings", path: "system.taskbarLyric.spectrumHoverBarCount" },
          min: 0,
          max: 24,
          step: 1,
          defaultValue: 7,
          marks: { 0: "关", 7: "7", 12: "12", 24: "24" },
          advanced: true,
        },
      ],
    },
  ],
};

const taskbarLyricCategory: SettingCategory = {
  id: "taskbarLyric",
  icon: IconLucidePanelBottom,
  sections: [taskbarLyricSection],
};

export default taskbarLyricCategory;
