import type { SettingCategory } from "@/types/settings-schema";
import RgbSyncPanel from "@/components/settings/custom/RgbSyncPanel.vue";
import IconLucideLightbulb from "~icons/lucide/lightbulb";

const rgbSyncCategory: SettingCategory = {
  id: "rgbSync",
  icon: IconLucideLightbulb,
  sections: [
    {
      id: "rgbSyncBasic",
      items: [
        {
          key: "rgbSyncEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.rgbSync.enabled" },
          defaultValue: false,
          tag: { text: "Beta", type: "info" },
        },
        {
          key: "rgbSyncHost",
          type: "text",
          binding: { store: "settings", path: "system.rgbSync.host" },
          defaultValue: "127.0.0.1",
          placeholderKey: "settings.rgbSyncHost.label",
          advanced: true,
        },
        {
          key: "rgbSyncPort",
          type: "number",
          binding: { store: "settings", path: "system.rgbSync.port" },
          min: 1,
          max: 65535,
          defaultValue: 6742,
          advanced: true,
        },
        {
          key: "rgbSyncFps",
          type: "slider",
          binding: { store: "settings", path: "system.rgbSync.fps" },
          min: 10,
          max: 60,
          step: 1,
          defaultValue: 30,
          marks: { 10: "10", 30: "30", 60: "60" },
          advanced: true,
        },
        {
          key: "rgbSyncBrightness",
          type: "slider",
          binding: { store: "settings", path: "system.rgbSync.brightness" },
          min: 0,
          max: 100,
          step: 1,
          defaultValue: 80,
          marks: { 0: "0", 50: "50", 100: "100" },
        },
      ],
    },
    {
      id: "rgbSyncDevices",
      items: [
        {
          key: "rgbSyncPanel",
          type: "custom",
          component: RgbSyncPanel,
          fullWidth: true,
          keywords: [
            "rgbSync.actions.connect",
            "rgbSync.actions.disconnect",
            "rgbSync.actions.refresh",
            "rgbSync.actions.test",
          ],
          advanced: true,
        },
      ],
    },
  ],
};

export default rgbSyncCategory;
