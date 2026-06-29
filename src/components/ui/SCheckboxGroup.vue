<script setup lang="ts">
import {
  checkboxGroupContextKey,
  type GroupSize,
  type SCheckboxGroupValue,
  toggleArrayValue,
} from "./group-context";

export interface SCheckboxGroupProps {
  /** 组选中值 */
  value?: SCheckboxGroupValue[];
  /** 组禁用 */
  disabled?: boolean;
  /** 组内统一尺寸 */
  size?: GroupSize;
}

const props = withDefaults(defineProps<SCheckboxGroupProps>(), {
  value: () => [],
  disabled: false,
  size: undefined,
});

const emit = defineEmits<{
  "update:value": [value: SCheckboxGroupValue[]];
}>();

const groupValue = computed(() => props.value);
const groupDisabled = computed(() => props.disabled);
const groupSize = computed(() => props.size);

const toggle = (item: SCheckboxGroupValue, checked: boolean): void => {
  const current = groupValue.value;
  const next = toggleArrayValue(current, item, checked);

  const changed = next.length !== current.length || next.some((v, i) => v !== current[i]);
  if (changed) {
    emit("update:value", next);
  }
};

provide(checkboxGroupContextKey, {
  value: groupValue,
  disabled: groupDisabled,
  size: groupSize,
  toggle,
});
</script>

<template>
  <div
    role="group"
    class="inline-flex flex-wrap items-center gap-3"
    :class="disabled ? 'opacity-60' : ''"
  >
    <slot />
  </div>
</template>
