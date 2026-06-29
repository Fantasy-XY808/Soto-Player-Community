import type { SettingCategory } from "@/types/settings-schema";
import { LOCALES } from "@shared/types/settings";
import StorageManager from "@/components/settings/custom/StorageManager.vue";
import MigrationPanel from "@/components/settings/custom/MigrationPanel.vue";
import { useUpdateStore } from "@/stores/update";
import IconLucideCog from "~icons/lucide/cog";

const generalCategory: SettingCategory = {
  id: "general",
  icon: IconLucideCog,
  sections: [
    {
      id: "language",
      items: [
        {
          key: "language",
          type: "select",
          binding: { store: "settings", path: "locale" },
          options: LOCALES.map(({ value, label }) => ({ value, label })),
          defaultValue: "zh-CN",
        },
      ],
    },
    {
      id: "systemConfig",
      items: [
        {
          key: "rememberWindowState",
          type: "switch",
          binding: { store: "settings", path: "system.system.rememberWindowState" },
          defaultValue: true,
        },
        {
          key: "taskbarProgress",
          type: "switch",
          binding: { store: "settings", path: "system.system.taskbarProgress" },
          defaultValue: true,
        },
        {
          key: "orpheusProtocol",
          type: "switch",
          binding: { store: "settings", path: "system.system.registerOrpheusProtocol" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "update",
      items: [
        {
          key: "autoCheckUpdate",
          type: "switch",
          binding: { store: "settings", path: "system.update.autoCheck" },
          defaultValue: true,
        },
        {
          key: "checkUpdate",
          type: "button",
          action: () => useUpdateStore().checkManually(),
        },
      ],
    },
    {
      id: "migration",
      items: [
        {
          key: "migrationPanel",
          type: "custom",
          component: MigrationPanel,
          fullWidth: true,
          keywords: ["migration.title", "migration.start"],
        },
      ],
    },
    {
      id: "backupReset",
      items: [
        {
          key: "storageManager",
          type: "custom",
          component: StorageManager,
          fullWidth: true,
          keywords: ["backup.label", "restore.label", "resetSettings.label", "resetAll.label"],
        },
      ],
    },
  ],
};

export default generalCategory;
