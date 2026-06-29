import type { SettingCategory } from "@/types/settings-schema";
import { useSettingsStore } from "@/stores/settings";
import DownloadDirConfig from "@/components/settings/custom/DownloadDirConfig.vue";
import FileCacheManager from "@/components/settings/custom/FileCacheManager.vue";
import DbCacheManager from "@/components/settings/custom/DbCacheManager.vue";
import IconLucideHardDrive from "~icons/lucide/hard-drive";

const storageCategory: SettingCategory = {
  id: "storage",
  icon: IconLucideHardDrive,
  sections: [
    {
      id: "downloadLocation",
      items: [
        {
          key: "downloadEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.download.enabled" },
          defaultValue: false,
          hideDescription: true,
        },
        {
          key: "downloadDir",
          type: "custom",
          component: DownloadDirConfig,
          fullWidth: true,
          keywords: ["downloadDir.label"],
        },
      ],
    },
    {
      id: "downloadGeneral",
      items: [
        {
          key: "downloadQuality",
          type: "select",
          binding: { store: "settings", path: "system.download.quality" },
          options: [
            { value: "jymaster", labelKey: "settings.songLevel.jymaster" },
            { value: "sky", labelKey: "settings.songLevel.sky" },
            { value: "jyeffect", labelKey: "settings.songLevel.jyeffect" },
            { value: "hi-res", labelKey: "settings.songLevel.hi-res" },
            { value: "lossless", labelKey: "settings.songLevel.lossless" },
            { value: "hq", labelKey: "settings.songLevel.hq" },
            { value: "sq", labelKey: "settings.songLevel.sq" },
            { value: "lq", labelKey: "settings.songLevel.lq" },
          ],
          defaultValue: "lossless",
        },
        {
          key: "downloadUsePlayback",
          type: "switch",
          binding: { store: "settings", path: "system.download.usePlaybackForDownload" },
          defaultValue: false,
        },
        {
          key: "downloadFileTemplate",
          type: "select",
          binding: { store: "settings", path: "system.download.fileTemplate" },
          options: [
            { value: "{title}", labelKey: "settings.downloadFileTemplate.titleOnly" },
            { value: "{artist} - {title}", labelKey: "settings.downloadFileTemplate.artistTitle" },
            { value: "{title} - {artist}", labelKey: "settings.downloadFileTemplate.titleArtist" },
          ],
          defaultValue: "{artist} - {title}",
        },
        {
          key: "downloadFolderScheme",
          type: "select",
          binding: { store: "settings", path: "system.download.folderScheme" },
          options: [
            { value: "none", labelKey: "settings.downloadFolderScheme.none" },
            { value: "artist", labelKey: "settings.downloadFolderScheme.artist" },
            { value: "artist-album", labelKey: "settings.downloadFolderScheme.artistAlbum" },
          ],
          defaultValue: "none",
        },
        {
          key: "downloadOverwrite",
          type: "select",
          binding: { store: "settings", path: "system.download.overwritePolicy" },
          options: [
            { value: "rename", labelKey: "settings.downloadOverwrite.rename" },
            { value: "overwrite", labelKey: "settings.downloadOverwrite.overwrite" },
            { value: "skip", labelKey: "settings.downloadOverwrite.skip" },
          ],
          defaultValue: "rename",
        },
      ],
    },
    {
      id: "downloadTags",
      items: [
        {
          key: "downloadLyricFormat",
          type: "select",
          binding: { store: "settings", path: "system.download.lyricFileFormat" },
          options: [
            { value: "lrc", labelKey: "settings.downloadLyricFormat.lrc" },
            { value: "enhanced-lrc", labelKey: "settings.downloadLyricFormat.enhanced" },
          ],
          defaultValue: "enhanced-lrc",
        },
        {
          key: "downloadEmbedCover",
          type: "switch",
          binding: { store: "settings", path: "system.download.embedCover" },
          defaultValue: true,
        },
        {
          key: "downloadEmbedMeta",
          type: "switch",
          binding: { store: "settings", path: "system.download.embedMeta" },
          defaultValue: true,
        },
        {
          key: "downloadEmbedLyric",
          type: "switch",
          binding: { store: "settings", path: "system.download.embedLyric" },
          defaultValue: true,
        },
        {
          key: "downloadWriteLrc",
          type: "switch",
          binding: { store: "settings", path: "system.download.writeLrc" },
          defaultValue: false,
        },
        {
          key: "downloadSaveTtml",
          type: "switch",
          binding: { store: "settings", path: "system.download.saveTtml" },
          defaultValue: false,
        },
      ],
    },
    {
      id: "songCache",
      items: [
        {
          key: "enableSongCache",
          type: "switch",
          binding: { store: "settings", path: "system.cache.songCache.enabled" },
          defaultValue: false,
          children: [
            {
              key: "songCacheSizeLimit",
              type: "slider",
              binding: { store: "settings", path: "system.cache.songCache.sizeLimitGb" },
              min: 0,
              max: 50,
              step: 1,
              marks: {
                0: "∞",
                10: "10G",
                20: "20G",
                50: "50G",
              },
              defaultValue: 10,
            },
          ],
          childrenCondition: () => useSettingsStore().system.cache?.songCache?.enabled === true,
        },
      ],
    },
    {
      id: "cache",
      items: [
        {
          key: "fileCacheManager",
          type: "custom",
          component: FileCacheManager,
          fullWidth: true,
          keywords: ["cacheDir.label", "fileClearAll.label"],
        },
      ],
    },
    {
      id: "database",
      items: [
        {
          key: "dbCacheManager",
          type: "custom",
          component: DbCacheManager,
          fullWidth: true,
          keywords: ["dbClearAll.label"],
        },
      ],
    },
  ],
};

export default storageCategory;
