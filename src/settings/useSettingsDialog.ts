import { settingsSchema } from "@/settings/schema";
import { useStatusStore } from "@/stores/status";

const open = ref(false);
const initialCategory = ref(settingsSchema[0].id);
const initialHighlight = ref<string>();

/** 校验分类 id 是否存在于当前 schema，不存在则回退到首个分类 */
const resolveCategory = (id: string | undefined): string => {
  if (id && settingsSchema.some((c) => c.id === id)) return id;
  return settingsSchema[0].id;
};

/**
 * 设置弹窗控制
 * 全局单例，任何组件都可调用 show() 打开设置
 */
export const useSettingsDialog = () => ({
  open,
  initialCategory,
  initialHighlight,

  /**
   * 打开设置弹窗
   * @param category - 本次定向到的分类
   * @param highlight - 需高亮定位的设置项 key
   */
  show: (category?: string, highlight?: string) => {
    initialCategory.value = resolveCategory(
      category ?? useStatusStore().settingsCategory ?? undefined,
    );
    initialHighlight.value = highlight;
    open.value = true;
  },

  /** 关闭设置弹窗 */
  hide: () => {
    open.value = false;
  },

  /** 记忆用户手动选择的大分类 */
  rememberCategory: (category: string) => {
    useStatusStore().settingsCategory = category;
  },
});
