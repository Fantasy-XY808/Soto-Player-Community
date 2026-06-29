import type { SettingCategory } from "@/types/settings-schema";
import generalCategory from "./categories/general";
import appearanceCategory from "./categories/appearance";
import windowCategory from "./categories/window";
import playbackCategory from "./categories/playback";
import audioCategory from "./categories/audio";
import playerUICategory from "./categories/playerUI";
import lyricCategory from "./categories/lyric";
import lyricStyleCategory from "./categories/lyricStyle";
import externalLyricCategory from "./categories/externalLyric";
import sourcesCategory from "./categories/sources";
import storageCategory from "./categories/storage";
import integrationsCategory from "./categories/integrations";
import hotkeysCategory from "./categories/hotkeys";
import pluginsCategory from "./categories/plugins";
import AboutSettings from "@/components/settings/custom/AboutSettings.vue";
import IconLucideInfo from "~icons/lucide/info";

export const settingsSchema: SettingCategory[] = [
  generalCategory,
  appearanceCategory,
  windowCategory,
  playbackCategory,
  audioCategory,
  playerUICategory,
  lyricCategory,
  lyricStyleCategory,
  externalLyricCategory,
  sourcesCategory,
  storageCategory,
  integrationsCategory,
  hotkeysCategory,
  pluginsCategory,
  { id: "about", icon: IconLucideInfo, component: AboutSettings },
];
