<script setup lang="ts">
import type { PlaylistExportFormat } from "@/services/playlist-transfer";
import { serializePlaylist } from "@/services/playlist-transfer";
import { toast } from "@/composables/useToast";
import IconLucideFileJson from "~icons/lucide/file-json";
import IconLucideListMusic from "~icons/lucide/list-music";
import IconLucideFileSpreadsheet from "~icons/lucide/file-spreadsheet";

const props = defineProps<{
  /** 是否打开 */
  open: boolean;
  /** 歌单名（用于默认文件名） */
  name: string;
  /** 歌曲列表 */
  tracks: import("@shared/types/player").Track[];
  /** 描述（写入 JSON meta） */
  description?: string;
}>();
const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const submitting = ref<PlaylistExportFormat | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) submitting.value = null;
  },
);

interface FormatOption {
  key: PlaylistExportFormat;
  label: string;
  desc: string;
  icon: Component;
  ext: string;
}

const formatOptions = computed<FormatOption[]>(() => [
  {
    key: "json",
    label: t("playlistTransfer.format.json"),
    desc: t("playlistTransfer.format.jsonDesc"),
    icon: markRaw(IconLucideFileJson),
    ext: ".json",
  },
  {
    key: "m3u",
    label: t("playlistTransfer.format.m3u"),
    desc: t("playlistTransfer.format.m3uDesc"),
    icon: markRaw(IconLucideListMusic),
    ext: ".m3u",
  },
  {
    key: "csv",
    label: t("playlistTransfer.format.csv"),
    desc: t("playlistTransfer.format.csvDesc"),
    icon: markRaw(IconLucideFileSpreadsheet),
    ext: ".csv",
  },
]);

const handlePick = async (format: PlaylistExportFormat): Promise<void> => {
  if (submitting.value) return;
  if (props.tracks.length === 0) {
    toast.warning(t("playlistTransfer.empty"));
    return;
  }
  submitting.value = format;
  try {
    const content = serializePlaylist(props.name, props.tracks, format, props.description);
    const result = await window.api.playlist.export(props.name, content, format);
    if (result.success) {
      toast.success(t("playlistTransfer.exportSuccess"));
      emit("update:open", false);
    } else if (result.reason !== "canceled") {
      toast.error(t("playlistTransfer.exportFailed"));
    }
  } catch (err) {
    console.error("[playlistTransfer] export failed:", err);
    toast.error(t("playlistTransfer.exportFailed"));
  } finally {
    submitting.value = null;
  }
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('playlistTransfer.formatTitle')"
    width="min(480px, calc(100vw - 32px))"
    @update:open="(v) => emit('update:open', v)"
  >
    <p class="text-sm text-on-surface-variant mb-4">
      {{ t("playlistTransfer.formatDesc") }}
    </p>
    <div class="grid grid-cols-1 gap-2.5">
      <button
        v-for="opt in formatOptions"
        :key="opt.key"
        type="button"
        :disabled="submitting !== null"
        :class="[
          'group flex items-start gap-3 p-3.5 rounded-lg border border-solid transition-all duration-200 text-left',
          submitting === opt.key
            ? 'border-primary bg-primary/8 cursor-wait'
            : 'border-outline-variant/30 hover:border-primary/40 hover:bg-primary/4 cursor-pointer',
          submitting !== null && submitting !== opt.key ? 'opacity-50' : '',
        ]"
        @click="handlePick(opt.key)"
      >
        <div
          :class="[
            'shrink-0 size-10 rounded-md flex items-center justify-center transition-colors',
            submitting === opt.key
              ? 'bg-primary/15 text-primary'
              : 'bg-primary/8 text-primary/80 group-hover:bg-primary/12',
          ]"
        >
          <component :is="opt.icon" class="size-5" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-medium text-on-surface">{{ opt.label }}</span>
            <STag size="small" variant="soft">{{ opt.ext }}</STag>
          </div>
          <div class="text-xs text-on-surface-variant/70 mt-1 leading-snug">{{ opt.desc }}</div>
        </div>
      </button>
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" :disabled="submitting !== null" @click="close">
        {{ t("common.cancel") }}
      </SButton>
    </template>
  </SDialog>
</template>
