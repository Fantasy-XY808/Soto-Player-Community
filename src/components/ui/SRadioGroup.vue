<script setup lang="ts">
import { radioGroupContextKey, type GroupSize, type SRadioGroupValue } from "./group-context";

export interface SRadioGroupProps {
  /** 组选中值 */
  value?: SRadioGroupValue | null;
  /** 原生分组名 */
  name?: string;
  /** 组禁用 */
  disabled?: boolean;
  /** 组内统一尺寸 */
  size?: GroupSize;
}

const props = withDefaults(defineProps<SRadioGroupProps>(), {
  value: null,
  name: undefined,
  disabled: false,
  size: undefined,
});

const emit = defineEmits<{
  "update:value": [value: SRadioGroupValue];
}>();

const groupValue = computed(() => props.value);
const groupName = computed(() => props.name);
const groupDisabled = computed(() => props.disabled);
const groupSize = computed(() => props.size);

const select = (item: SRadioGroupValue): void => {
  if (groupValue.value === item) return;
  emit("update:value", item);
};

provide(radioGroupContextKey, {
  value: groupValue,
  name: groupName,
  disabled: groupDisabled,
  size: groupSize,
  select,
});
</script>

<template>
  <div
    role="radiogroup"
    :aria-disabled="disabled ? 'true' : 'false'"
    class="inline-flex flex-wrap items-center gap-3"
    :class="disabled ? 'opacity-60' : ''"
  >
    <slot />
  </div>
</template>
