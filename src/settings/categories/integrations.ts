import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import ExternalApiPanel from "@/components/settings/custom/ExternalApiPanel.vue";
import LastfmPanel from "@/components/settings/custom/LastfmPanel.vue";
import ListenTogetherPanel from "@/components/settings/custom/ListenTogetherPanel.vue";
import IconLucideLink from "~icons/lucide/link";

const integrationsCategory: SettingCategory = {
  id: "integrations",
  icon: IconLucideLink,
  sections: [
    {
      id: "media",
      items: [
        {
          key: "systemMediaControls",
          type: "switch",
          binding: { store: "settings", path: "system.media.systemMediaControls" },
          defaultValue: true,
        },
      ],
    },
    {
      id: "discord",
      items: [
        {
          key: "discordEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.media.discord.enabled" },
          defaultValue: false,
          children: [
            {
              key: "discordShowWhenPaused",
              type: "switch",
              binding: { store: "settings", path: "system.media.discord.showWhenPaused" },
              defaultValue: false,
            },
            {
              key: "discordDisplayMode",
              type: "select",
              binding: { store: "settings", path: "system.media.discord.displayMode" },
              options: [
                { value: "name", labelKey: "settings.discordDisplayMode.name" },
                { value: "details", labelKey: "settings.discordDisplayMode.details" },
                { value: "state", labelKey: "settings.discordDisplayMode.state" },
              ],
              defaultValue: "name",
            },
          ],
        },
      ],
    },
    {
      id: "lastfm",
      items: [
        {
          key: "lastfmEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.lastfm.enabled" },
          defaultValue: false,
          children: [
            {
              key: "lastfmAccount",
              type: "custom",
              component: LastfmPanel,
              fullWidth: true,
              keywords: ["settings.lastfm.connect", "settings.lastfm.disconnect"],
            },
            {
              key: "lastfmScrobble",
              type: "switch",
              binding: { store: "settings", path: "system.lastfm.scrobble" },
              defaultValue: true,
            },
            {
              key: "lastfmNowPlaying",
              type: "switch",
              binding: { store: "settings", path: "system.lastfm.nowPlaying" },
              defaultValue: true,
            },
            {
              key: "lastfmLoveSync",
              type: "switch",
              binding: { store: "settings", path: "system.lastfm.loveSync" },
              defaultValue: true,
            },
          ],
        },
      ],
    },
    {
      id: "scrobble",
      tag: { text: "Beta" },
      items: [
        {
          key: "neteaseScrobbleEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.system.neteaseScrobbleEnabled" },
          defaultValue: false,
          children: [
            {
              key: "neteaseScrobbleMode",
              type: "select",
              binding: { store: "settings", path: "system.system.neteaseScrobbleMode" },
              options: [
                { value: "legacy", labelKey: "settings.neteaseScrobbleMode.legacy" },
                { value: "ncbl", labelKey: "settings.neteaseScrobbleMode.ncbl" },
              ],
              defaultValue: "ncbl",
            },
          ],
        },
      ],
    },
    {
      id: "externalApi",
      tag: { text: "Beta" },
      items: [
        {
          key: "externalApiEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.externalApi.enabled" },
          defaultValue: false,
          children: [
            {
              key: "externalApiWs",
              type: "switch",
              binding: { store: "settings", path: "system.externalApi.wsEnabled" },
              defaultValue: false,
            },
            {
              key: "externalApiAllowLan",
              type: "switch",
              binding: { store: "settings", path: "system.externalApi.allowLan" },
              defaultValue: false,
            },
            {
              key: "externalApiPort",
              type: "number",
              binding: { store: "settings", path: "system.externalApi.port" },
              min: 1024,
              max: 65535,
              defaultValue: 14558,
            },
            {
              key: "externalApiPanel",
              type: "custom",
              component: ExternalApiPanel,
              fullWidth: true,
              keywords: ["settings.externalApi.endpoint", "settings.externalApi.restart"],
            },
          ],
        },
      ],
    },
    {
      id: "listenTogether",
      tag: { text: "Beta" },
      items: [
        {
          key: "listenTogetherEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.listenTogether.enabled" },
          defaultValue: false,
          children: [
            {
              key: "listenTogetherPort",
              type: "number",
              binding: { store: "settings", path: "system.listenTogether.port" },
              min: 1024,
              max: 65535,
              defaultValue: 23333,
            },
            {
              key: "listenTogetherProgressMode",
              type: "select",
              binding: { store: "settings", path: "system.listenTogether.progressMode" },
              options: [
                {
                  value: "manual",
                  labelKey: "settings.listenTogether.progressMode.manual",
                },
                {
                  value: "interval",
                  labelKey: "settings.listenTogether.progressMode.interval",
                },
                {
                  value: "songOnly",
                  labelKey: "settings.listenTogether.progressMode.songOnly",
                },
              ],
              defaultValue: "manual",
            },
            {
              key: "listenTogetherProgressInterval",
              type: "number",
              binding: { store: "settings", path: "system.listenTogether.progressInterval" },
              min: 500,
              max: 60000,
              step: 500,
              defaultValue: 2000,
              visible: () => useSettingsStore().system.listenTogether.progressMode === "interval",
            },
            {
              key: "listenTogetherQueueMode",
              type: "select",
              binding: { store: "settings", path: "system.listenTogether.queueMode" },
              options: [
                {
                  value: "currentOnly",
                  labelKey: "settings.listenTogether.queueMode.currentOnly",
                },
                {
                  value: "currentAndNext",
                  labelKey: "settings.listenTogether.queueMode.currentAndNext",
                },
                {
                  value: "fullQueue",
                  labelKey: "settings.listenTogether.queueMode.fullQueue",
                },
              ],
              defaultValue: "currentAndNext",
            },
            {
              key: "listenTogetherAutoReconnect",
              type: "switch",
              binding: { store: "settings", path: "system.listenTogether.autoReconnect" },
              defaultValue: true,
            },
            {
              key: "listenTogetherPanel",
              type: "custom",
              component: ListenTogetherPanel,
              fullWidth: true,
              keywords: [
                "listenTogether.host.stop",
                "listenTogether.join.leave",
                "settings.listenTogether.panelTitle",
              ],
            },
          ],
        },
      ],
    },
  ],
};

export default integrationsCategory;
