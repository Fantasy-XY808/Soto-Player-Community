<script setup lang="ts">
import type { ContentScope } from "@/types/collection";
import { usePlaylistStore } from "@/stores/playlist";
import { useUserStore } from "@/stores/user";
import { toast } from "@/composables/useToast";

const props = defineProps<{
  open: boolean;
  /** 本地 / 在线 */
  mode: ContentScope;
}>();
const emit = defineEmits<{
  "update:open": [value: boolean];
  /** 新建成功，参数为新歌单 id */
  created: [playlistId: string];
}>();

const { t } = useI18n();
const playlistStore = usePlaylistStore();
const userStore = useUserStore();

const name = ref("");
const privacy = ref<0 | 10>(0);
const submitting = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      name.value = "";
      privacy.value = 0;
      submitting.value = false;
    }
  },
);

const handleConfirm = async (): Promise<void> => {
  const value = name.value.trim();
  if (!value || submitting.value) return;
  submitting.value = true;
  try {
    const id =
      props.mode === "local"
        ? (await playlistStore.create(value)).id
        : (await userStore.createPlaylist(value, privacy.value)).id;
    if (!id) {
      toast.error(t("liked.toast.failed"));
      return;
    }
    emit("created", id);
    emit("update:open", false);
  } catch (err) {
    const message = err instanceof Error && err.message ? err.message : t("liked.toast.failed");
    toast.error(message);
  } finally {
    submitting.value = false;
  }
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('collection.create', { type: t('collection.playlist') })"
    width="400px"
    @update:open="(v) => emit('update:open', v)"
  >
    <div class="flex flex-col gap-4">
      <SInput
        v-model="name"
        :placeholder="t('collection.playlist')"
        :disabled="submitting"
        clearable
        @keyup.enter="handleConfirm"
      />
      <div v-if="mode === 'online'" class="flex items-center gap-2">
        <span class="text-on-surface">{{ t("collection.privacy.private") }}</span>
        <SSwitch
          :model-value="privacy === 10"
          :disabled="submitting"
          @update:model-value="(v: boolean) => (privacy = v ? 10 : 0)"
        />
      </div>
    </div>
    <template #footer="{ close }">
      <SButton variant="tertiary" :disabled="submitting" @click="close">
        {{ t("common.cancel") }}
      </SButton>
      <SButton type="primary" :disabled="!name.trim()" :loading="submitting" @click="handleConfirm">
        {{ t("common.confirm") }}
      </SButton>
    </template>
  </SDialog>
</template>
