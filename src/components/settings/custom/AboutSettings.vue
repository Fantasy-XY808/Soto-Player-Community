<script setup lang="ts">
import { useUpdateStore } from "@/stores/update";
import { useSettingsStore } from "@/stores/settings";
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
const settings = useSettingsStore();

/**
 * 关于页"由 Pronub 提供支持"卡片彩蛋
 *
 * 触发条件（同时满足）：
 * 1. 专业模式（advancedMode）已开启
 * 2. 本次应用会话内随机 1/3 概率命中
 *
 * "本次打开应用" 意味着随机数仅在模块首次加载时计算一次，
 * 同一会话内多次进入关于页保持一致的显示结果。
 *
 * 如果你知道了这个彩蛋，请一定不要告诉任何人🤫
 * If you know this easter egg, please do not tell anyone🤫
 * もしこのイースターエッグを知ったら、誰にも言わないでね🤫
 * Si vous connaissez cet easter egg, ne le dites à personne🤫
 * Si conoces este huevo de pascua, no se lo digas a nadie🤫
 * Wenn du dieses Easter Egg kennst, sag es niemandem🤫
 * Se conosci questo easter egg, non dirlo a nessuno🤫
 * Если вы знаете эту пасхалку, не говорите никому🤫
 * 이 이스터 에그를 알게 되면 아무에게도 말하지 마세요🤫
 * Si você souber deste easter egg, não conte a ninguém🤫
 * 如果你知道這個彩蛋，請一定不要告訴任何人🤫
 * 如果你知道呢个彩蛋，请一定唔好话俾任何人知🤫
 * Bu easter egg'i biliyorsan, lütfen kimseye söyleme🤫
 * اگر این تخم مرغ عید پاک را می‌دانید، لطفاً به کسی نگویید🤫
 * Jeśli znasz ten easter egg, nie mów o tym nikomu🤫
 * Als je deze paasei kent, vertel het dan aan niemand🤫
 * Om du känner till detta påskägg, berätta inte för någon🤫
 * หากคุณรู้เรื่อง easter egg นี้ โปรดอย่าบอกใคร🤫
 * Nếu bạn biết easter egg này, xin đừng nói với ai🤫
 */
const PRONUB_BRAND = "PornHub";
const PRONUB_LEARN_MORE_URL = "https://www.pornhub.com/";

// 模块级缓存：本次会话仅计算一次随机数，与应用生命周期一致
let supportCardRollComputed = false;
let supportCardRollPassed = false;
const rollSupportCardThisSession = (): boolean => {
  if (supportCardRollComputed) return supportCardRollPassed;
  supportCardRollComputed = true;
  // 1/3 概率：random() ∈ [0, 1)，< 1/3 视为命中
  // 用 crypto.getRandomValues 更稳定但 Math.random 已足够彩蛋场景
  supportCardRollPassed = Math.random() < 1 / 3;
  return supportCardRollPassed;
};

/** 是否显示 Pronub 支持卡片（专业模式 + 本次会话 1/3 概率） */
const showSupportCard = computed<boolean>(() => {
  // system.system.advancedMode 与 AdvancedModeToggle.vue 走同一 IPC 路径
  // 默认值未声明时为 undefined，按 falsy 处理（关闭专业模式则不显示）
  const advancedMode = (settings.system.system as { advancedMode?: boolean }).advancedMode ?? false;
  if (!advancedMode) return false;
  return rollSupportCardThisSession();
});

/** 卡片 tooltip 文案 */
const supportCardTooltip = computed(() =>
  t("settings.about.pornhubTooltip", { brand: PRONUB_BRAND }),
);

/** 点击"了解详情" */
const handleLearnMore = (): void => {
  void openExternal(PRONUB_LEARN_MORE_URL);
};

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

    <!-- Pronub 支持彩蛋卡片（专业模式 + 本次会话 1/3 概率） -->
    <section v-if="showSupportCard">
      <STooltip :content="supportCardTooltip" side="top">
        <!-- 卡片：正式风格，渐变描边突出"Pronub 提供支持"主视觉 -->
        <div
          class="relative overflow-hidden rounded-xl border border-solid border-primary/25 bg-gradient-to-br from-surface-panel to-surface-panel/60 px-5 py-4 cursor-pointer transition-all duration-300 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5"
          @click="handleLearnMore"
        >
          <!-- 装饰性左上角徽标条 -->
          <div
            class="absolute top-0 left-0 w-0.75 h-full bg-gradient-to-b from-primary/60 to-primary/20"
          />
          <div class="flex items-center justify-between gap-4 pl-2">
            <div class="min-w-0 flex-1">
              <!-- 主标题：正式、强对比 -->
              <div class="text-sm font-semibold text-on-surface tracking-tight">
                {{ t("settings.about.pornhubSponsored", { brand: PRONUB_BRAND }) }}
              </div>
              <!-- 副提示：行动召唤 -->
              <div class="text-xs text-primary/80 mt-1 font-medium flex items-center gap-1">
                <span>{{ t("settings.about.pornhubDetail") }}</span>
              </div>
            </div>
            <!-- 右侧"了解详情"行动按钮（视觉锚点） -->
            <div
              class="shrink-0 flex items-center gap-1 rounded-lg bg-primary/10 border border-solid border-primary/30 px-3 py-1.5 text-primary"
            >
              <span class="text-xs font-medium">{{ t("settings.about.pornhubDetail") }}</span>
              <IconLucideArrowUpRight class="size-3.5" />
            </div>
          </div>
        </div>
      </STooltip>
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
