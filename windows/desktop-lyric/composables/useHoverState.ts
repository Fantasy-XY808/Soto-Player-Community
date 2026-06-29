import type { Ref } from "vue";

/**
 * 由主进程 screen.getCursorScreenPoint() 轮询结果驱动
 */
export const useHoverState = (): {
  isHovered: Ref<boolean>;
} => {
  const isHovered = ref(false);
  let unsubscribe: (() => void) | null = null;

  onMounted(() => {
    unsubscribe = window.api.desktopLyric.onCursorInside((inside) => {
      isHovered.value = inside;
    });
  });

  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
  });

  return { isHovered };
};
