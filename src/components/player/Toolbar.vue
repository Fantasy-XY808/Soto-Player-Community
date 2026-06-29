<script setup lang="ts">
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { useMediaStore } from "@/stores/media";
import { useSettingsDialog } from "@/settings/useSettingsDialog";
import * as player from "@/core/player";
import IconLucideSliders from "~icons/lucide/sliders-horizontal";
import IconLucideGauge from "~icons/lucide/gauge";
import IconLucideMoreVertical from "~icons/lucide/more-vertical";
import IconLucideClock from "~icons/lucide/clock";
import IconLucideRepeat2 from "~icons/lucide/repeat-2";
import IconLucideBarChart3 from "~icons/lucide/bar-chart-3";
import IconLucidePalette from "~icons/lucide/palette";
import IconLucideMessageCircle from "~icons/lucide/message-circle";
import IconLucideCopy from "~icons/lucide/copy";

const props = withDefaults(
  defineProps<{
    /** 是否使用封面主题 */
    cover?: boolean;
  }>(),
  { cover: false },
);

const emit = defineEmits<{
  /** 打开评论面板（仅 FullPlayer 场景有意义） */
  "open-comment": [];
  /** 打开歌词卡片对话框（仅 FullPlayer 场景有意义） */
  "open-lyric-card": [];
}>();

const { t } = useI18n();
const router = useRouter();
const status = useStatusStore();
const settings = useSettingsStore();
const media = useMediaStore();
const { show: showSettings } = useSettingsDialog();
const { isDesktopLyricOpen } = storeToRefs(settings);
const { equalizerOpen } = storeToRefs(status);

const buttonType = computed<"default" | "cover">(() => (props.cover ? "cover" : "default"));
const mutedClass = computed(() => (props.cover ? "text-cover/50" : "text-on-surface-variant"));

const lyricButtonType = computed(() =>
  isDesktopLyricOpen.value ? (props.cover ? "cover" : "primary") : buttonType.value,
);

const volumePercent = computed(() => Math.round(status.volume * 100));

/** 静音前的音量，用于解除静音时恢复 */
const lastVolume = ref(status.volume || 0.7);

const onVolumeWheel = (e: WheelEvent): void => {
  const delta = e.deltaY < 0 ? 0.05 : -0.05;
  const next = Math.max(0, Math.min(1, status.volume + delta));
  player.setVolume(next);
};

const toggleMute = (): void => {
  if (status.volume > 0) {
    lastVolume.value = status.volume;
    player.setVolume(0);
  } else {
    player.setVolume(lastVolume.value || 0.7);
  }
};

const toggleDesktopLyric = (): void => {
  window.api.window.toggleDesktopLyric().catch(() => {});
};

const speedOpen = ref(false);
const autoCloseOpen = ref(false);
const abLoopOpen = ref(false);

/** 当前音源是否支持评论（仅网易云有评论 API） */
const commentSupported = computed(() => media.track?.source === "netease");
/** 当前是否有可复制的歌词 */
const hasLyric = computed(() => media.parsedLyric.length > 0);

/**
 * 更多操作菜单：基础项 + FullPlayer 场景的快捷入口
 * 用户反馈"找不到功能入口"——把音乐报告/播放器外观/评论/歌词卡片都收到这里
 */
const moreMenuItems = computed<DropdownMenuItem[]>(() => {
  const items: DropdownMenuItem[] = [
    { key: "equalizer", label: t("equalizer.title"), icon: IconLucideSliders },
    { key: "speed", label: t("speed.title"), icon: IconLucideGauge },
    { key: "abLoop", label: t("abLoop.title"), icon: IconLucideRepeat2 },
    { key: "autoClose", label: t("autoClose.title"), icon: IconLucideClock },
    { key: "musicReport", label: t("nav.musicReport"), icon: IconLucideBarChart3 },
    { key: "playerAppearance", label: t("settings.group.playerUI"), icon: IconLucidePalette },
  ];
  // FullPlayer 场景额外加评论与歌词卡片入口
  if (props.cover) {
    items.push(
      {
        key: "comment",
        label: t("comment.title"),
        icon: IconLucideMessageCircle,
        disabled: !commentSupported.value,
      },
      {
        key: "lyricCard",
        label: t("player.copyLyric.title"),
        icon: IconLucideCopy,
        disabled: !hasLyric.value,
      },
    );
  }
  return items;
});

const onMoreMenuSelect = (key: string): void => {
  if (key === "equalizer") equalizerOpen.value = true;
  else if (key === "speed") speedOpen.value = true;
  else if (key === "abLoop") abLoopOpen.value = true;
  else if (key === "autoClose") autoCloseOpen.value = true;
  else if (key === "musicReport") router.push("/report");
  else if (key === "playerAppearance") showSettings("playerUI");
  else if (key === "comment") emit("open-comment");
  else if (key === "lyricCard") emit("open-lyric-card");
};
</script>

<template>
  <div class="flex items-center gap-1">
    <!-- 在线音质 -->
    <QualityControl v-if="settings.appearance.showQualitySwitch" :cover="cover" />
    <SPopover trigger="hover" side="top" :cover="cover" content-class="px-3 pb-2 pt-3">
      <template #trigger>
        <SButton
          :type="buttonType"
          variant="ghost"
          circle
          size="large"
          :class="mutedClass"
          @click="toggleMute"
          @wheel.prevent="onVolumeWheel"
        >
          <template #icon>
            <IconLucideVolumeX v-if="volumePercent === 0" />
            <IconLucideVolume1 v-else-if="volumePercent < 50" />
            <IconLucideVolume2 v-else />
          </template>
        </SButton>
      </template>
      <div class="flex flex-col items-center w-7" @wheel.prevent="onVolumeWheel">
        <div class="h-30">
          <SSlider
            :model-value="status.volume"
            :min="0"
            :max="1"
            :step="0.01"
            :thumb-size="15"
            :track-height="5"
            :cover="cover"
            vertical
            @change="player.setVolume($event)"
          />
        </div>
        <span class="text-xs tabular-nums mt-2">{{ volumePercent }}%</span>
      </div>
    </SPopover>
    <SButton
      :type="lyricButtonType"
      :variant="isDesktopLyricOpen ? 'tertiary' : 'ghost'"
      circle
      size="large"
      :class="isDesktopLyricOpen ? undefined : mutedClass"
      @click="toggleDesktopLyric"
    >
      <template #icon><IconLucideMicVocal /></template>
    </SButton>
    <SButton
      v-if="!status.fmMode && cover"
      :type="buttonType"
      :variant="status.fullQueueOpen ? 'tertiary' : 'ghost'"
      circle
      size="large"
      :class="status.fullQueueOpen ? undefined : mutedClass"
      @click="status.fullQueueOpen = !status.fullQueueOpen"
    >
      <template #icon><IconLucideListMusic /></template>
    </SButton>
    <SPopover
      v-else-if="!status.fmMode"
      v-model:open="status.outerQueueOpen"
      trigger="click"
      side="top"
      :side-offset="12"
      content-class="!p-0 w-72 h-[min(60vh,520px)] overflow-hidden"
    >
      <template #trigger>
        <SButton
          :type="status.outerQueueOpen ? 'primary' : buttonType"
          :variant="status.outerQueueOpen ? 'tertiary' : 'ghost'"
          circle
          size="large"
          :class="status.outerQueueOpen ? undefined : mutedClass"
        >
          <template #icon><IconLucideListMusic /></template>
        </SButton>
      </template>
      <QueuePopover @close="status.outerQueueOpen = false" />
    </SPopover>
    <SDropdownMenu
      :items="moreMenuItems"
      side="top"
      align="end"
      :cover="cover"
      @select="onMoreMenuSelect"
    >
      <template #trigger>
        <SButton :type="buttonType" variant="ghost" circle size="large" :class="mutedClass">
          <template #icon><IconLucideMoreVertical /></template>
        </SButton>
      </template>
    </SDropdownMenu>
    <EqualizerDialog v-model:open="equalizerOpen" />
    <SpeedDialog v-model:open="speedOpen" />
    <AbLoopDialog v-model:open="abLoopOpen" />
    <AutoCloseDialog v-model:open="autoCloseOpen" />
  </div>
</template>
