import { useSettingsStore } from "@/stores/settings";
import { useThemeStore } from "@/stores/theme";
import { getByPath, setByPath } from "@shared/utils/path";
import { virtualBindings } from "./virtualBindings";
import { computed, type WritableComputedRef } from "vue";

/**
 * 根据 binding 配置创建与 store 双向绑定的 computed
 * 仅在 SettingsItem 组件内按需调用
 */
export const useSettingModel = (binding: {
  store: "settings" | "theme";
  path: string;
}): WritableComputedRef<any> => {
  if (binding.store === "theme") {
    const store = useThemeStore();
    return computed({
      get: () => getByPath(store, binding.path),
      set: (v) => setByPath(store, binding.path, v),
    });
  }
  // 虚拟 binding
  const virtual = virtualBindings[binding.path];
  if (virtual) {
    return computed({ get: virtual.get, set: virtual.set });
  }

  const store = useSettingsStore();

  // system.* 路径需要走 IPC 持久化
  if (binding.path.startsWith("system.")) {
    const ipcPath = binding.path.slice(7);
    return computed({
      get: () => getByPath(store.system, ipcPath),
      set: (v) => store.setSystem(ipcPath, v),
    });
  }

  return computed({
    get: () => getByPath(store, binding.path),
    set: (v) => {
      setByPath(store, binding.path, v);
      store.afterLocalChange(binding.path, v);
    },
  });
};
