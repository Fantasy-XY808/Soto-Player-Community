<script setup lang="ts">
import {
  radioGroupContextKey,
  type GroupSize,
  type GroupValue,
  type SRadioGroupValue,
} from "./group-context";
type SRadioSize = GroupSize;

export interface SRadioProps {
  /** 选中状态（语义优先） */
  checked?: boolean;
  /** 兼容默认 v-model（不推荐） */
  modelValue?: GroupValue | null;
  /** 当前项值 */
  value?: GroupValue;
  /** 禁用状态 */
  disabled?: boolean;
  /** 尺寸 */
  size?: SRadioSize;
  /** 文本标签（也可用默认插槽） */
  label?: string;
}

const props = withDefaults(defineProps<SRadioProps>(), {
  modelValue: null,
  value: true,
  checked: undefined,
  disabled: false,
  size: undefined,
  label: "",
});

const emit = defineEmits<{
  /** 语义事件：单项点击选中 */
  change: [value: GroupValue];
  /** 兼容默认 v-model（不推荐） */
  "update:modelValue": [value: GroupValue];
}>();

const radioGroup = inject(radioGroupContextKey, null);

const sizeClassMap: Record<SRadioSize, string> = {
  small: "size-4",
  medium: "size-4.5",
  large: "size-5",
};

const dotSizeClassMap: Record<SRadioSize, string> = {
  small: "size-1.5",
  medium: "size-2",
  large: "size-2.5",
};

const mergedSize = computed<SRadioSize>(() => props.size ?? radioGroup?.size.value ?? "medium");

const hasLabel = computed(() => !!props.label || !!useSlots().default);

const selected = computed(() => {
  if (radioGroup) return radioGroup.value.value === props.value;
  if (typeof props.checked === "boolean") return props.checked;
  return props.modelValue === props.value;
});

const mergedDisabled = computed(() => props.disabled || radioGroup?.disabled.value === true);

const radioName = computed(() => radioGroup?.name.value);

const handleSelect = (): void => {
  if (mergedDisabled.value || selected.value) return;
  const nextValue = props.value;
  if (radioGroup) {
    radioGroup.select(nextValue as SRadioGroupValue);
  } else {
    emit("update:modelValue", nextValue);
  }
  emit("change", nextValue);
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key !== " " && event.key !== "Enter") return;
  event.preventDefault();
  handleSelect();
};
</script>

<template>
  <label
    class="inline-flex items-center gap-2 select-none"
    :class="mergedDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'"
  >
    <button
      type="button"
      role="radio"
      :name="radioName"
      :aria-checked="selected ? 'true' : 'false'"
      :disabled="mergedDisabled"
      class="shrink-0 inline-flex items-center justify-center rounded-full border border-solid outline-none transition-[background-color,border-color,box-shadow] duration-200"
      :class="[
        sizeClassMap[mergedSize],
        selected
          ? 'border-primary bg-primary/10'
          : 'border-on-surface/35 bg-transparent hover:border-on-surface/55',
      ]"
      @click="handleSelect"
      @keydown="onKeydown"
    >
      <span
        class="rounded-full transition-[opacity,transform,background-color] duration-200"
        :class="[
          dotSizeClassMap[mergedSize],
          selected ? 'opacity-100 scale-100 bg-primary' : 'opacity-0 scale-60 bg-primary',
        ]"
      />
    </button>
    <span v-if="hasLabel" class="text-sm text-on-surface">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>
