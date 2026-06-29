import type { InjectionKey, Ref } from "vue";

/** 组值类型 */
export type GroupValue = string | number | boolean;
export type GroupSize = "small" | "medium" | "large";

/** 多选组上下文 */
export interface MultiSelectGroupContext<T extends GroupValue> {
  value: Ref<T[]>;
  disabled: Ref<boolean>;
  size: Ref<GroupSize | undefined>;
  toggle: (item: T, checked: boolean) => void;
}

/** 单选组上下文 */
export interface SingleSelectGroupContext<T extends GroupValue> {
  value: Ref<T | null>;
  disabled: Ref<boolean>;
  size: Ref<GroupSize | undefined>;
  name: Ref<string | undefined>;
  select: (item: T) => void;
}

/** 创建类型安全的注入 key */
export const createGroupContextKey = <T>(name: string): InjectionKey<T> =>
  Symbol(name) as InjectionKey<T>;

/** 多选数组通用切换逻辑 */
export const toggleArrayValue = <T>(current: readonly T[], item: T, checked: boolean): T[] => {
  const has = current.includes(item);
  if (checked && !has) return [...current, item];
  if (!checked && has) return current.filter((v) => v !== item);
  return [...current];
};

/** CheckboxGroup 上下文 key 与值类型 */
export type SCheckboxGroupValue = GroupValue;
export const checkboxGroupContextKey =
  createGroupContextKey<MultiSelectGroupContext<SCheckboxGroupValue>>("SCheckboxGroupContext");

/** RadioGroup 上下文 key 与值类型 */
export type SRadioGroupValue = GroupValue;
export const radioGroupContextKey =
  createGroupContextKey<SingleSelectGroupContext<SRadioGroupValue>>("SRadioGroupContext");
