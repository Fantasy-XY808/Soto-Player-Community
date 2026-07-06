<script setup lang="ts">
import { useUpdateStore } from "@/stores/update";
import { openExternal } from "@/utils/url";
import {
  APP_VERSION,
  REPO_URL,
  REPO_NAME,
  HOMEPAGE_URL,
  COPYRIGHT_HOLDER,
  AUTHOR_URL,
} from "@/utils/config";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideGithub from "~icons/lucide/github";
import IconLucideRss from "~icons/lucide/rss";
import IconLucideArrowUpRight from "~icons/lucide/arrow-up-right";
import IconLucideMessageCircle from "~icons/lucide/message-circle";

const { t } = useI18n();
const update = useUpdateStore();

/** 检查更新中 */
const checking = computed(() => update.phase === "checking");

/** 触发更新检查 */
const handleCheckUpdate = (): void => {
  if (update.hasUpdate) {
    update.openDialog();
    return;
  }
  update.checkManually();
};

/** 打开日志目录 */
const handleOpenLogs = (): void => void window.api.system.openLogsDir();

interface Dependency {
  name: string;
  description: string;
  url: string;
}

/** 依赖的开源项目 */
const dependencies: Dependency[] = [
  {
    name: "EasyTier",
    description: "一起听 P2P 内网穿透 — 网络组网引擎（已内嵌全平台二进制）",
    url: "https://github.com/EasyTier/EasyTier",
  },
  {
    name: "SPlayer-Next",
    description: "本项目上游 — 现代化桌面音乐播放器",
    url: "https://github.com/SPlayer-Dev/SPlayer-Next",
  },
  {
    name: "applemusic-like-lyrics",
    description: "类 Apple Music 歌词显示组件库",
    url: "https://github.com/Steve-xmh/applemusic-like-lyrics",
  },
  {
    name: "NeteaseCloudMusicApiEnhanced",
    description: "网易云音乐 API 备份 + 增强",
    url: "https://github.com/neteasecloudmusicapienhanced/api-enhanced",
  },
];

/** 社区与资讯入口 */
const community = computed(() => [
  { name: REPO_NAME, url: REPO_URL, icon: IconLucideGithub },
  { name: t("settings.about.officialSite"), url: HOMEPAGE_URL, icon: IconLucideRss },
  {
    name: t("settings.about.qqGroup"),
    url: "https://qm.qq.com/q/1043061896",
    icon: IconLucideMessageCircle,
  },
]);

/** 开发人员：作者本人（GitHub 用户名 + 主页链接） */
const developers = computed(() => {
  // 从 AUTHOR_URL 提取 GitHub 用户名作为展示名
  const match = AUTHOR_URL.match(/github\.com\/([^/]+)/);
  const login = match ? match[1] : COPYRIGHT_HOLDER;
  return [
    {
      login,
      avatar: `https://github.com/${login}.png`,
      htmlUrl: AUTHOR_URL,
    },
  ];
});
</script>

<template>
  <div class="flex flex-col gap-8">
    <!-- 关于软件 -->
    <section>
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.aboutApp") }}
      </h3>
      <div
        class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 p-4 flex flex-wrap items-center gap-4"
      >
        <SLogo :size="34" />
        <div class="flex items-center gap-2 mr-auto">
          <span class="text-lg font-logo text-on-surface">{{ REPO_NAME }}</span>
          <STag type="primary" size="small" round>v{{ APP_VERSION }}</STag>
        </div>
        <div class="flex items-center gap-2">
          <SButton variant="secondary" :loading="checking" @click="handleCheckUpdate">
            <template #icon><IconLucideRefreshCw /></template>
            {{
              update.hasUpdate
                ? t("settings.about.newVersion")
                : checking
                  ? t("settings.about.checking")
                  : t("settings.about.checkUpdate")
            }}
          </SButton>
          <SButton variant="secondary" @click="handleOpenLogs">
            {{ t("settings.about.openLogs") }}
          </SButton>
        </div>
      </div>
      <p
        class="text-xs text-on-surface-variant/70 leading-relaxed mt-3 px-3 py-2 rounded-lg border border-solid border-outline-variant/15 bg-surface-panel/40"
      >
        {{ t("settings.about.description") }}
      </p>
    </section>

    <!-- 特别致谢 -->
    <section>
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.specialThanks") }}
      </h3>
      <div class="grid grid-cols-3 gap-2.5">
        <button
          v-for="dep in dependencies"
          :key="dep.name"
          class="group text-left rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3 transition-colors hover:border-primary/40 cursor-pointer"
          @click="openExternal(dep.url)"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-medium text-on-surface truncate">{{ dep.name }}</span>
            <IconLucideArrowUpRight
              class="size-3.5 text-on-surface-variant/40 group-hover:text-primary transition-colors"
            />
          </div>
          <div class="text-xs text-on-surface-variant/70 mt-0.5 line-clamp-1">
            {{ dep.description }}
          </div>
        </button>
      </div>
      <p class="mt-2 px-1 text-[11px] text-on-surface-variant/50">
        {{ t("settings.about.visualInspiration") }}
      </p>
    </section>

    <!-- 开发人员 -->
    <section>
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.developers") }}
      </h3>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <button
          v-for="dev in developers"
          :key="dev.login"
          class="text-left rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-3 py-2.5 flex items-center gap-2.5 transition-colors hover:border-primary/40 cursor-pointer"
          @click="openExternal(dev.htmlUrl)"
        >
          <SImg
            :src="dev.avatar"
            fallback="/images/avatar.jpg"
            class="size-9 rounded-full shrink-0"
          />
          <div class="min-w-0">
            <div class="text-sm font-medium text-on-surface truncate">{{ dev.login }}</div>
            <div class="text-xs text-on-surface-variant/60 truncate">
              {{ t("settings.about.role.author") }}
            </div>
          </div>
        </button>
      </div>
    </section>

    <!-- 社区与资讯 -->
    <section>
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.community") }}
      </h3>
      <div class="grid grid-cols-3 gap-2.5">
        <button
          v-for="item in community"
          :key="item.name"
          class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3 flex items-center gap-2.5 transition-colors hover:border-primary/40 cursor-pointer"
          @click="openExternal(item.url)"
        >
          <component :is="item.icon" class="size-5 text-on-surface-variant shrink-0" />
          <span class="text-sm font-medium text-on-surface truncate">{{ item.name }}</span>
        </button>
      </div>
    </section>
  </div>
</template>
