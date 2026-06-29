import type { Ref, VNode } from "vue";

export type DialogType = "default" | "info" | "success" | "warning" | "error";

export interface DialogOptions {
  /** 标题 */
  title?: string;
  /** 副标题描述 */
  description?: string;
  /** 正文内容 */
  content?: string;
  /** 自定义正文渲染 */
  body?: () => VNode | VNode[];
  /** 确认按钮文案，默认"确定" */
  confirmText?: string;
  /** 取消按钮文案，默认"取消"；仅 confirm 有效 */
  cancelText?: string;
  /** 主题类型，影响确认按钮颜色 */
  type?: DialogType;
  /** 是否显示关闭按钮，默认 true */
  closable?: boolean;
}

export interface DialogItem {
  id: number;
  kind: "alert" | "confirm";
  options: DialogOptions;
  /** 用 ref 承载 open，配合 shallowReactive 的数组也能触发深层变更 */
  open: Ref<boolean>;
  resolve: (value: boolean) => void;
  /** 是否已结算，防止 Reka 关闭回调再次触发 settle */
  settled: boolean;
}

/** 全局对话框队列 */
const dialogs = shallowReactive<DialogItem[]>([]);

/** 下一个 dialog ID */
let nextId = 0;

/**
 * 关闭并结算（resolved 为 true 表示点击确认）
 * 先把 open 置 false 触发 Reka Presence 关闭动画（overlay-out 200ms + dialog-out 150ms），
 * 动画结束后再从数组里移除，避免 v-for 立即卸载打断动画
 */
const settle = (id: number, resolved: boolean): void => {
  const item = dialogs.find((entry) => entry.id === id);
  if (!item || item.settled) return;
  item.settled = true;
  item.open.value = false;
  item.resolve(resolved);
  setTimeout(() => {
    const index = dialogs.findIndex((entry) => entry.id === id);
    if (index !== -1) dialogs.splice(index, 1);
  }, 250);
};

/** 入队一个对话框 */
const push = (kind: "alert" | "confirm", options: DialogOptions): Promise<boolean> => {
  return new Promise((resolve) => {
    dialogs.push({
      id: nextId++,
      kind,
      options,
      open: ref(true),
      resolve,
      settled: false,
    });
  });
};

/** 命令式对话框 API */
export const dialog = {
  /** 仅确认按钮，点击或关闭后 resolve */
  alert: (options: DialogOptions): Promise<void> => push("alert", options).then(() => undefined),
  /** 确认 + 取消，resolve true/false */
  confirm: (options: DialogOptions): Promise<boolean> => push("confirm", options),
  /** 手动关闭某个对话框 */
  close: (id: number): void => settle(id, false),
};

/** 供容器组件使用 */
export const useDialog = () => ({ dialogs, settle });
