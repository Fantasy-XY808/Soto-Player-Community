import { toast } from "@/composables/useToast";

/**
 * 复制文本到剪贴板，自动 toast 反馈
 */
export const useCopyText = () => {
  const { t } = useI18n();

  /**
   * 复制文本
   * @param text - 要复制的内容
   */
  const copy = async (text: string | null | undefined): Promise<void> => {
    if (!text) {
      toast.error(t("common.copyFailed"));
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("common.copied"));
    } catch {
      toast.error(t("common.copyFailed"));
    }
  };

  return { copy };
};
