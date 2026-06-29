<script setup lang="ts">
export interface SSwitchProps {
  modelValue?: boolean;
  disabled?: boolean;
  /** 是否为圆形（默认圆形，false 为圆角矩形） */
  round?: boolean;
}

withDefaults(defineProps<SSwitchProps>(), {
  modelValue: false,
  disabled: false,
  round: true,
});

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();
</script>

<template>
  <SwitchRoot
    :model-value="modelValue"
    :disabled="disabled"
    class="group relative inline-flex items-center w-10 h-5.5 shrink-0 border-none p-0 cursor-pointer outline-none transition-[background-color] duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
    :class="[
      modelValue ? 'bg-primary/80 hover:bg-primary/70' : 'bg-on-surface/20 hover:bg-on-surface/30',
      round ? 'rounded-full' : 'rounded-lg',
    ]"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <SwitchThumb
      class="block h-4 w-4 bg-white pointer-events-none transition-[transform,width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] group-active:w-5"
      :class="[
        modelValue ? 'translate-x-5.25 group-active:translate-x-4.25' : 'translate-x-0.75',
        round ? 'rounded-full' : 'rounded-md',
      ]"
    />
  </SwitchRoot>
</template>
