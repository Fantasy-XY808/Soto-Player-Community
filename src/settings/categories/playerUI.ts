import type { SettingCategory } from "@/types/settings-schema";
import IconLucideMonitorPlay from "~icons/lucide/monitor-play";

const playerUICategory: SettingCategory = {
  id: "playerUI",
  icon: IconLucideMonitorPlay,
  sections: [
    {
      id: "playerBackground",
      items: [
        {
          key: "playerBgType",
          type: "select",
          binding: { store: "settings", path: "player.playerBgType" },
          options: [
            { value: "blur", labelKey: "settings.playerBgType.blur" },
            { value: "solid", labelKey: "settings.playerBgType.solid" },
          ],
          defaultValue: "blur",
        },
        {
          key: "enableFluidBackground",
          type: "switch",
          binding: { store: "settings", path: "player.enableFluidBackground" },
          defaultValue: true,
        },
        {
          key: "enableSnowBackground",
          type: "switch",
          binding: { store: "settings", path: "player.enableSnowBackground" },
          defaultValue: false,
        },
        {
          key: "enableFogBackground",
          type: "switch",
          binding: { store: "settings", path: "player.enableFogBackground" },
          defaultValue: false,
        },
        {
          key: "enableRaindropBackground",
          type: "switch",
          binding: { store: "settings", path: "player.enableRaindropBackground" },
          defaultValue: false,
        },
        {
          key: "coverLayout",
          type: "select",
          binding: { store: "settings", path: "player.coverLayout" },
          options: [
            { value: "default", labelKey: "settings.coverLayout.default" },
            { value: "fullscreen", labelKey: "settings.coverLayout.fullscreen" },
          ],
          defaultValue: "default",
        },
        {
          key: "autoCenterCover",
          type: "switch",
          binding: { store: "settings", path: "player.autoCenterCover" },
          defaultValue: true,
        },
        {
          key: "showPureMusicComment",
          type: "switch",
          binding: { store: "settings", path: "player.showPureMusicComment" },
          defaultValue: true,
        },
        {
          key: "followCoverColor",
          type: "switch",
          binding: { store: "settings", path: "player.followCoverColor" },
          defaultValue: true,
        },
        {
          key: "autoImmersive",
          type: "switch",
          binding: { store: "settings", path: "player.autoImmersive" },
          defaultValue: false,
        },
        {
          key: "enableParallaxTilt",
          type: "switch",
          binding: { store: "settings", path: "player.enableParallaxTilt" },
          defaultValue: true,
        },
        {
          key: "enableCoverBreathing",
          type: "switch",
          binding: { store: "settings", path: "player.enableCoverBreathing" },
          defaultValue: true,
        },
      ],
    },
    {
      id: "musicSpectrum",
      tag: { text: "Beta" },
      items: [
        {
          key: "enableSpectrum",
          type: "switch",
          binding: { store: "settings", path: "player.enableSpectrum" },
          defaultValue: false,
          children: [
            {
              key: "spectrumBarWidth",
              type: "slider",
              binding: { store: "settings", path: "player.spectrumBarWidth" },
              min: 1,
              max: 12,
              step: 1,
              defaultValue: 4,
              marks: { 1: "1", 4: "4", 8: "8", 12: "12" },
            },
            {
              key: "spectrumSensitivity",
              type: "slider",
              binding: { store: "settings", path: "player.spectrumSensitivity" },
              min: 0.5,
              max: 3,
              step: 0.1,
              defaultValue: 1,
              marks: { 0.5: "0.5", 1: "1", 2: "2", 3: "3" },
            },
            {
              key: "spectrumMaxHeight",
              type: "slider",
              binding: { store: "settings", path: "player.spectrumMaxHeight" },
              min: 0.3,
              max: 5,
              step: 0.1,
              defaultValue: 5,
              marks: { 0.3: "0.3", 1: "1", 3: "3", 5: "5" },
            },
            {
              key: "spectrumSmoothing",
              type: "slider",
              binding: { store: "settings", path: "player.spectrumSmoothing" },
              min: 0,
              max: 0.9,
              step: 0.05,
              defaultValue: 0.5,
              marks: { 0: "0", 0.5: "0.5", 0.9: "0.9" },
            },
            {
              key: "spectrumStyle",
              type: "select",
              binding: { store: "settings", path: "player.spectrumStyle" },
              options: [
                { value: "bar", labelKey: "settings.spectrumStyle.bar" },
                { value: "curve", labelKey: "settings.spectrumStyle.curve" },
                { value: "around", labelKey: "settings.spectrumStyle.around" },
              ],
              defaultValue: "bar",
            },
          ],
        },
      ],
    },
  ],
};

export default playerUICategory;
