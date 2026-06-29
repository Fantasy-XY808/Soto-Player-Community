import type { SettingCategory } from "@/types/settings-schema";
import IconLucidePlayCircle from "~icons/lucide/play-circle";

const playbackCategory: SettingCategory = {
  id: "playback",
  icon: IconLucidePlayCircle,
  sections: [
    {
      id: "playControl",
      items: [
        {
          key: "autoPlay",
          type: "switch",
          binding: { store: "settings", path: "system.player.autoPlay" },
          defaultValue: true,
        },
        {
          key: "rememberLastTrack",
          type: "switch",
          binding: { store: "settings", path: "system.player.rememberLastTrack" },
          defaultValue: false,
        },
        {
          key: "fadeEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.player.fadeEnabled" },
          defaultValue: true,
          children: [
            {
              key: "fadeDuration",
              type: "slider",
              binding: { store: "settings", path: "system.player.fadeDuration" },
              min: 100,
              max: 600,
              step: 100,
              defaultValue: 200,
              marks: { 100: "100", 200: "200", 600: "600" },
            },
          ],
        },
      ],
    },
  ],
};

export default playbackCategory;
