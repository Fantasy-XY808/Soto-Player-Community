/**
 * 省电模式 composable
 *
 * 综合"系统电源状态"与"用户设置"判定是否应降级视觉效果：
 * - reduceMode === "auto"：跟随系统电源状态（isPowerSave）
 * - reduceMode === "always"：强制降级
 * - reduceMode === "never"：从不降级
 * - autoReduce === false：总开关关闭，永远不降级
 *
 * 多组件复用：模块级 ref 缓存系统电源状态，多个组件订阅共享同一份状态。
 */
import type { ComputedRef, Ref } from "vue";
import { watch } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { setFpsLimit } from "@/services/rafScheduler";

/** 系统电源状态（模块级共享） */
const isPowerSaveSystem = ref(false);
const isOnBattery = ref(false);
const batteryPercent = ref(100);

/** 是否已初始化（避免多个组件同时调用 init 触发重复 IPC） */
let initialized = false;

/**
 * 初始化：拉取一次初始状态 + 订阅主进程事件 + 接入 FPS 限制
 *
 * 多次调用幂等，仅在首次调用时执行实际订阅。
 * FPS 限制 watch 在首次调用时注册一次（watch 在 setup 之外调用，
 * 不绑定组件 effect scope，作为应用级监听器存活到进程退出）。
 */
const init = (): void => {
  if (initialized) return;
  initialized = true;

  // 拉取初始状态
  void window.api.system.getPowerState().then((snapshot) => {
    isPowerSaveSystem.value = snapshot.isPowerSave;
    isOnBattery.value = snapshot.isOnBattery;
    batteryPercent.value = snapshot.batteryPercent;
  });

  // 订阅后续变化
  window.api.system.onPowerSaveModeChanged((snapshot) => {
    isPowerSaveSystem.value = snapshot.isPowerSave;
    isOnBattery.value = snapshot.isOnBattery;
    batteryPercent.value = snapshot.batteryPercent;
  });

  // 接入 FPS 限制：isPowerSaveMode + limitFpsTo30 任一变化时同步 setFpsLimit
  // 此 watch 在 setup 之外注册，绑定到模块级（应用级）生命周期，不会随组件卸载被回收
  const settings = useSettingsStore();
  const isPowerSaveMode = computed(() => {
    const { autoReduce, reduceMode } = settings.system.system.powerSave;
    if (!autoReduce) return false;
    if (reduceMode === "always") return true;
    if (reduceMode === "never") return false;
    return isPowerSaveSystem.value;
  });
  watch(
    [isPowerSaveMode, () => settings.system.system.powerSave.reduceItems.limitFpsTo30],
    () => {
      setFpsLimit(
        isPowerSaveMode.value && settings.system.system.powerSave.reduceItems.limitFpsTo30,
      );
    },
    { immediate: true },
  );
};

/**
 * 省电模式 composable
 *
 * @returns
 *   - isPowerSaveMode：综合用户设置后是否应降级视觉效果
 *   - isOnBattery：是否使用电池供电
 *   - batteryPercent：电池电量百分比（0-100）
 */
export const usePowerSave = (): {
  isPowerSaveMode: ComputedRef<boolean>;
  isOnBattery: Ref<boolean>;
  batteryPercent: Ref<number>;
} => {
  const settings = useSettingsStore();

  // 确保仅初始化一次（首次调用此 composable 的组件触发）
  init();

  /** 综合用户设置后是否应降级视觉效果 */
  const isPowerSaveMode = computed(() => {
    const { autoReduce, reduceMode } = settings.system.system.powerSave;
    if (!autoReduce) return false;
    if (reduceMode === "always") return true;
    if (reduceMode === "never") return false;
    // reduceMode === "auto"：跟随系统
    return isPowerSaveSystem.value;
  });

  return {
    isPowerSaveMode,
    isOnBattery,
    batteryPercent,
  };
};
