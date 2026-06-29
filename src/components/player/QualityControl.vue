<script setup lang="ts">
import type { SSelectOption } from "@/components/ui/SSelect.vue";
import type { QualityLevel } from "@/utils/quality";
import { useMediaStore } from "@/stores/media";
import { useSettingsStore } from "@/stores/settings";
import { useUserStore } from "@/stores/user";
import {
  QUALITY_LABELS,
  clampQualityLevel,
  getQualityLabel,
  isVipOnlyLevel,
} from "@/utils/quality";
import * as player from "@/core/player";
import { toast } from "@/composables/useToast";
import IconLucideGauge from "~icons/lucide/gauge";

withDefaults(defineProps<{ cover?: boolean }>(), { cover: false });

const { t } = useI18n();
const media = useMediaStore();
const settings = useSettingsStore();
const user = useUserStore();

/** 是否支持切换在线音质 */
const canSwitchQuality = computed(() => media.track?.source === "netease" && !media.track?.cloud);

/** 实际播放音质：网易云源优先显示用户选择档位（clamp 到权限内），其他源按物理参数推断 */
const qualityLabel = computed(() => {
  if (canSwitchQuality.value) {
    const clamped = clampQualityLevel(
      settings.player.songLevel,
      user.isLoggedIn,
      (user.profile?.vipType ?? 0) !== 0,
    );
    return QUALITY_LABELS[clamped];
  }
  return getQualityLabel(media.detail?.quality) || t("settings.songLevel.unknown");
});

/** 当前用户权限状态 */
const isLoggedIn = computed(() => user.isLoggedIn);
const isVip = computed(() => (user.profile?.vipType ?? 0) !== 0);

/** 全部 8 档音质（从低到高） */
const ALL_LEVELS: QualityLevel[] = [
  "lq",
  "sq",
  "hq",
  "lossless",
  "hi-res",
  "jyeffect",
  "sky",
  "jymaster",
];

/** 权限提示文案：未登录/VIP 专属 */
const levelHint = (level: QualityLevel): string => {
  if (!isLoggedIn.value) return t("settings.songLevel.loginRequired");
  if (isVipOnlyLevel(level) && !isVip.value) return t("settings.songLevel.vipRequired");
  return "";
};

/** 音质偏好下拉选项；不可用档位禁用并提示原因 */
const qualityOptions = computed<SSelectOption[]>(() =>
  ALL_LEVELS.map((level) => {
    const hint = levelHint(level);
    const disabled = hint !== "";
    const label = t(`settings.songLevel.${level}`);
    return {
      value: level,
      label: disabled ? `${label} · ${hint}` : label,
      disabled,
    };
  }),
);

const chipBase =
  "inline-flex min-w-9 shrink-0 items-center justify-center gap-1 px-2 py-1 leading-none rounded-md border border-solid text-xs";

/** 切换音质：选了 VIP 专属档但权限不足时提示，避免用户以为"音质都一个样" */
const onQualityChange = (value: string | number | boolean): void => {
  const level = value as QualityLevel;
  const clamped = clampQualityLevel(level, isLoggedIn.value, isVip.value);
  if (clamped !== level) {
    // 选了高档位但被 clamp 降级：明确告知，避免用户困惑"为什么切了没区别"
    toast.warning(
      isVipOnlyLevel(level) && !isLoggedIn.value
        ? t("settings.songLevel.clampedLogin")
        : t("settings.songLevel.clampedVip"),
    );
  }
  settings.player.songLevel = level;
  void player.reloadCurrentTrack();
};
</script>

<template>
  <SPopselect
    v-if="canSwitchQuality"
    :model-value="settings.player.songLevel"
    :options="qualityOptions"
    side="top"
    :side-offset="8"
    :cover="cover"
    @update:model-value="onQualityChange"
  >
    <template #header>
      <div
        :class="[
          'w-0 min-w-full px-2.5 pt-2 pb-1.5 text-xs leading-snug border-b border-b-solid',
          cover
            ? 'text-cover/55 border-b-white/10'
            : 'text-on-surface-variant/70 border-b-on-surface/8',
        ]"
      >
        <div class="mb-0.5 text-sm font-medium" :class="cover ? 'text-cover' : 'text-on-surface'">
          {{ t("settings.songLevel.switchTitle") }}
        </div>
        {{ t("settings.songLevel.switchHint") }}
      </div>
    </template>
    <template #trigger>
      <span
        :class="[
          chipBase,
          'cursor-pointer transition-colors',
          cover
            ? 'border-white/40 text-white/95 bg-black/35 backdrop-blur-sm hover:bg-black/45 hover:border-white/60'
            : 'border-primary/40 text-primary hover:border-primary/70 bg-primary/5',
        ]"
        :title="t('settings.songLevel.switchTitle')"
      >
        <IconLucideGauge class="size-3 opacity-90" />
        {{ qualityLabel }}
      </span>
    </template>
  </SPopselect>
  <STooltip
    v-else-if="media.detail?.quality"
    :content="t('settings.songLevel.unsupportedHint')"
    :side-offset="16"
    side="top"
  >
    <span
      :class="[
        chipBase,
        cover
          ? 'border-white/40 text-white/95 bg-black/35 backdrop-blur-sm'
          : 'border-on-surface-variant/30 text-on-surface-variant/90',
      ]"
    >
      <IconLucideGauge class="size-3 opacity-90" />
      {{ qualityLabel }}
    </span>
  </STooltip>
  <!-- 详情未加载或无音质元数据时也保留入口，避免用户找不到音质按钮 -->
  <span
    v-else
    :class="[
      chipBase,
      cover
        ? 'border-white/40 text-white/95 bg-black/35 backdrop-blur-sm'
        : 'border-on-surface-variant/25 text-on-surface-variant/70',
    ]"
  >
    <IconLucideGauge class="size-3 opacity-90" />
    {{ qualityLabel }}
  </span>
</template>
