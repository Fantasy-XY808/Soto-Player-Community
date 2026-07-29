/**
 * 运行日志查看器弹窗控制
 *
 * 全局单例：任何组件都可调用 show() 打开日志查看器。
 * 与 useSettingsDialog 同模式，确保 NavHeader 菜单与外部唤起共用同一开关。
 */
const open = ref(false);

/** 初始选中的日志文件名（默认为今日，由 LogsViewer 内部回退） */
const initialLogFile = ref<string | undefined>();

export const useLogsViewer = () => ({
  open,
  initialLogFile,

  /** 打开日志查看器，可指定初始选中文件 */
  show: (fileName?: string) => {
    initialLogFile.value = fileName;
    open.value = true;
  },

  /** 关闭日志查看器 */
  hide: () => {
    open.value = false;
  },
});
