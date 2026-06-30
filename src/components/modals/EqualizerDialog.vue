<script setup lang="ts">
import EqualizerControl from "@/components/settings/custom/EqualizerControl.vue";

defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
</script>

<template>
  <SDialog
    :open="open"
    :title="t('equalizer.title')"
    width="640px"
    @update:open="emit('update:open', $event)"
  >
    <EqualizerControl />
    <template #footer="{ close }">
      <SButton type="primary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
