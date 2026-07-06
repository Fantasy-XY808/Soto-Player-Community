import type { SettingCategory } from "@/types/settings-schema";
import IconLucideDisc3 from "~icons/lucide/disc-3";

const automixCategory: SettingCategory = {
  id: "automix",
  icon: IconLucideDisc3,
  sections: [
    {
      id: "automixMain",
      items: [
        {
          key: "automixEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.automix.enabled" },
          defaultValue: false,
          tag: { text: "Beta", type: "warning" },
        },
        {
          key: "automixStrategy",
          type: "select",
          binding: { store: "settings", path: "system.automix.strategy" },
          options: [
            { value: "bpmKey", labelKey: "settings.automixStrategy.strategy.bpmKey" },
            { value: "bpm", labelKey: "settings.automixStrategy.strategy.bpm" },
            { value: "key", labelKey: "settings.automixStrategy.strategy.key" },
            { value: "random", labelKey: "settings.automixStrategy.strategy.random" },
          ],
          defaultValue: "bpmKey",
        },
        {
          key: "automixBpmTolerance",
          type: "slider",
          binding: { store: "settings", path: "system.automix.bpmTolerance" },
          min: 0,
          max: 30,
          step: 1,
          defaultValue: 8,
          marks: { 0: "0", 8: "8", 16: "16", 30: "30" },
        },
        {
          key: "automixKeyMatchMode",
          type: "select",
          binding: { store: "settings", path: "system.automix.keyMatchMode" },
          options: [
            { value: "off", labelKey: "settings.automixKeyMatchMode.mode.off" },
            { value: "camelot", labelKey: "settings.automixKeyMatchMode.mode.camelot" },
            { value: "strict", labelKey: "settings.automixKeyMatchMode.mode.strict" },
          ],
          defaultValue: "camelot",
        },
      ],
    },
    {
      id: "automixTransition",
      items: [
        {
          key: "automixCrossfadeEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.automix.crossfadeEnabled" },
          defaultValue: true,
          children: [
            {
              key: "automixCrossfadeMs",
              type: "slider",
              binding: { store: "settings", path: "system.automix.crossfadeMs" },
              min: 500,
              max: 12000,
              step: 500,
              defaultValue: 8000,
              marks: { 500: "0.5s", 4000: "4s", 8000: "8s", 12000: "12s" },
            },
          ],
        },
        {
          key: "automixCandidatePoolSize",
          type: "slider",
          binding: { store: "settings", path: "system.automix.candidatePoolSize" },
          min: 3,
          max: 30,
          step: 1,
          defaultValue: 10,
          marks: { 3: "3", 10: "10", 20: "20", 30: "30" },
        },
      ],
    },
    {
      id: "automixAnalysis",
      items: [
        {
          key: "automixAutoAnalyze",
          type: "switch",
          binding: { store: "settings", path: "system.automix.autoAnalyze" },
          defaultValue: true,
        },
        {
          key: "automixAutoRecommend",
          type: "switch",
          binding: { store: "settings", path: "system.automix.autoRecommend" },
          defaultValue: false,
          tag: { text: "Soon", type: "info" },
        },
      ],
    },
  ],
};

export default automixCategory;
