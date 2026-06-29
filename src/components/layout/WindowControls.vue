<script setup lang="ts">
import { useWindowControls } from "@/composables/useWindowControls";
import IconMinus from "~icons/lucide/minus";
import IconSquare from "~icons/lucide/square";
import IconCopy from "~icons/lucide/copy";
import IconX from "~icons/lucide/x";

const props = defineProps<{
  /** 使用 cover 主题 */
  cover?: boolean;
  /** 直接退出 */
  directQuit?: boolean;
}>();

const { isMaximized, minimize, toggleMaximize, close, quit } = useWindowControls();

const onClose = (): void => {
  props.directQuit ? quit() : close();
};
</script>

<template>
  <div class="flex items-center gap-3 shrink-0">
    <SButton
      class="app-no-drag"
      :type="cover ? 'cover' : undefined"
      :variant="cover ? 'ghost' : 'tertiary'"
      circle
      :size="40"
      :icon-size="16"
      @click="minimize"
    >
      <template #icon><IconMinus /></template>
    </SButton>
    <SButton
      class="app-no-drag"
      :type="cover ? 'cover' : undefined"
      :variant="cover ? 'ghost' : 'tertiary'"
      circle
      :size="40"
      :icon-size="16"
      @click="toggleMaximize"
    >
      <template #icon>
        <component :is="isMaximized ? IconCopy : IconSquare" />
      </template>
    </SButton>
    <SButton
      class="app-no-drag"
      :type="cover ? 'cover' : undefined"
      :variant="cover ? 'ghost' : 'tertiary'"
      circle
      :size="40"
      @click="onClose"
    >
      <template #icon><IconX /></template>
    </SButton>
  </div>
</template>
