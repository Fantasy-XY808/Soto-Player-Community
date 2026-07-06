import type { SettingCategory } from "@/types/settings-schema";
import StreamingServerList from "@/components/settings/custom/StreamingServerList.vue";
import QqAccountCard from "@/components/settings/custom/QqAccountCard.vue";
import KugouAccountCard from "@/components/settings/custom/KugouAccountCard.vue";
import QishuiPluginHint from "@/components/settings/custom/QishuiPluginHint.vue";
import SongUnlockServerConfig from "@/components/settings/custom/SongUnlockServerConfig.vue";
import IconLucideLibrary from "~icons/lucide/library";

const sourcesCategory: SettingCategory = {
  id: "sources",
  icon: IconLucideLibrary,
  sections: [
    {
      id: "streaming",
      items: [
        {
          key: "streamingEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.streaming.enabled" },
          defaultValue: true,
        },
        {
          key: "streamingServerList",
          type: "custom",
          component: StreamingServerList,
          fullWidth: true,
          keywords: ["streaming.server.add", "streaming.server.test", "streaming.server.connect"],
        },
      ],
    },
    {
      id: "qqAccount",
      items: [
        {
          key: "qqAccountCard",
          type: "custom",
          component: QqAccountCard,
          fullWidth: true,
          keywords: ["login.platformQQMusic", "login.manualCookie"],
        },
      ],
    },
    {
      id: "kugouAccount",
      items: [
        {
          key: "kugouAccountCard",
          type: "custom",
          component: KugouAccountCard,
          fullWidth: true,
          keywords: ["login.platformKugou", "login.manualCookie"],
        },
      ],
    },
    {
      id: "qishuiPlugin",
      items: [
        {
          key: "qishuiPluginHint",
          type: "custom",
          component: QishuiPluginHint,
          fullWidth: true,
          keywords: ["login.platformQishui", "settings.plugins.import"],
        },
      ],
    },
    {
      id: "songUnlockServer",
      items: [
        {
          key: "songUnlockServerConfig",
          type: "custom",
          component: SongUnlockServerConfig,
          fullWidth: true,
          keywords: [
            "settings.songUnlockServer.netease.name",
            "settings.songUnlockServer.kuwo.name",
          ],
        },
      ],
    },
    {
      id: "network",
      items: [
        {
          key: "neteaseRealIp",
          type: "switch",
          binding: { store: "settings", path: "system.system.neteaseRealIp" },
          defaultValue: false,
        },
      ],
    },
  ],
};

export default sourcesCategory;
