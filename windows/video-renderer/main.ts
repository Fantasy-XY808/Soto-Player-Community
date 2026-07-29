/**
 * 视频渲染窗口入口
 *
 * 复用主窗口的整套前端基础设施（pinia / i18n / 全局样式 / 主题 store），
 * 让渲染窗口可以挂载 <FullPlayer> 视觉层，保证"所见即所得"。
 *
 * 关键差异：
 * - 不安装路由、不安装 hotkey、不初始化播放器（播放由本窗口内部 <audio> 驱动）
 * - settings store 的 IPC 订阅照常工作（preload 全量暴露 api）
 * - theme store 持久化到 localStorage（与主窗口共享同一 origin → file://）
 *
 * 离屏窗口 show:false 时 document.hidden=true，会导致 rafScheduler 停摆、
 * 歌词引擎 / 频谱 / 流体背景全部不刷新。渲染前强制覆盖为 false 并拦截
 * visibilitychange 事件，保证 RAF 全速推进。
 */

import "virtual:uno.css";
import "@/styles/global.css";

import { createApp } from "vue";
import { createPinia } from "pinia";
import piniaPersistedstate from "pinia-plugin-persistedstate";
import i18n from "@/i18n";
import App from "./App.vue";
import { useThemeStore } from "@/stores/theme";
import { useSettingsStore } from "@/stores/settings";
import { setVideoRendererFlag } from "@/composables/useVideoRendererFlag";
import { setRafSchedulerMode } from "@/services/rafScheduler";

// 必须在 app.mount 之前设置：rafScheduler 模块加载时会读取此 flag，
// 若 flag 为 false 会保持 raf 模式，导致 RAF 被 Chromium 节流 → 视觉停滞
setVideoRendererFlag(true);
// 显式切换到 setTimeout 调度，绕过离屏窗口 RAF 节流
// （document.hidden 覆写无法绕过 Chromium 内部 RAF 调度策略）
setRafSchedulerMode("setTimeout");

/**
 * 离屏窗口可见性覆写
 *
 * BrowserWindow show:false 时 document.hidden=true → rafScheduler 停摆 →
 * 歌词逐字高亮 / 频谱条 / 流体背景全部不刷新。
 *
 * 渲染窗口已设置 backgroundThrottling:false，Electron 不会真正节流 RAF，
 * 但 Page Visibility API 仍会判定为 hidden。此处强制覆盖为 false，
 * 并阻止 visibilitychange 事件冒泡，让所有依赖 document.hidden 的逻辑
 * （rafScheduler / FullPlayer 沉浸模式 / useBreathing 等）按"可见"路径走。
 */
const overrideDocumentVisibility = (): void => {
  try {
    Object.defineProperty(document, "hidden", {
      get: () => false,
      configurable: true,
    });
    Object.defineProperty(document, "webkitHidden", {
      get: () => false,
      configurable: true,
    });
    Object.defineProperty(document, "visibilityState", {
      get: () => "visible",
      configurable: true,
    });
    // 拦截 visibilitychange 事件，防止 rafScheduler 接收到 hidden 状态切换
    document.addEventListener(
      "visibilitychange",
      (e) => {
        e.stopImmediatePropagation();
      },
      true,
    );
    // eslint-disable-next-line no-console
    console.info("[ERR-70003-M] document.visibility 已覆写为 visible");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ERR-70003-N] document.visibility 覆写失败", err);
  }
};

overrideDocumentVisibility();

const pinia = createPinia();
pinia.use(piniaPersistedstate);

const app = createApp(App);
app.use(pinia);
app.use(i18n);

// 同步 locale 到 i18n.global（与主窗口 main.ts 行为一致）
watch(
  () => useSettingsStore().locale,
  (v) => {
    i18n.global.locale.value = v;
  },
  { immediate: true },
);

// 初始化主题 store：应用调色板 / 暗色模式 / 液态玻璃样式到 DOM
useThemeStore().init();

app.mount("#app");

// eslint-disable-next-line no-console
console.info("[ERR-70003-O] 视频渲染窗口已挂载");
