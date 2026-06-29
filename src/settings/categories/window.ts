import type { SettingCategory } from "@/types/settings-schema";
import IconLucideAppWindow from "~icons/lucide/app-window";

const windowCategory: SettingCategory = {
  id: "window",
  icon: IconLucideAppWindow,
  sections: [
    {
      id: "windowBehavior",
      items: [
        {
          key: "closeAction",
          type: "select",
          binding: { store: "settings", path: "appearance.closeAction" },
          options: [
            { value: "quit", labelKey: "settings.closeAction.quit" },
            { value: "hide", labelKey: "settings.closeAction.hide" },
          ],
          defaultValue: "hide",
        },
        {
          key: "rememberCloseChoice",
          type: "switch",
          binding: { store: "settings", path: "appearance.rememberCloseChoice" },
          defaultValue: false,
        },
      ],
    },
  ],
};

export default windowCategory;
