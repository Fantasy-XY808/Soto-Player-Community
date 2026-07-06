import "virtual:uno.css";
import "@/styles/global.css";

import piniaPersistedstate from "pinia-plugin-persistedstate";
import App from "./App.vue";
import router from "./router";
import i18n from "./i18n";

import { useThemeStore } from "./stores/theme";
import { useSettingsStore } from "./stores/settings";
import { useHotkeyStore } from "./stores/hotkey";
import { initPlayer } from "./core/player";
import { installHotkeyManager } from "./core/hotkey/manager";
import { vRipple } from "./directives/ripple";
import { useVisibilityPause } from "./composables/useVisibilityPause";
import { runIdle } from "./services/performanceOptimization";

const pinia = createPinia();
pinia.use(piniaPersistedstate);

const app = createApp(App);
app.directive("ripple", vRipple);
app.use(pinia);
app.use(router);
app.use(i18n);

useThemeStore().init();

useVisibilityPause();

watch(
  () => useSettingsStore().locale,
  (v) => {
    i18n.global.locale.value = v;
    window.api.system.setLocale(v);
  },
  { immediate: true },
);

const SPLASH_ANIM_MS = 2050;

router.isReady().then(() => {
  app.mount("#app");
  const remaining = Math.max(0, SPLASH_ANIM_MS - performance.now());
  setTimeout(() => {
    const loading = document.getElementById("app-loading");
    if (loading) {
      loading.classList.add("hidden");
      loading.addEventListener("transitionend", () => loading.remove(), { once: true });
    }
  }, remaining);
  initPlayer().catch(console.error);
  useHotkeyStore()
    .init()
    .then(installHotkeyManager)
    .catch((err) => console.error("[hotkey] init failed", err));

  runIdle(() => {
    if ("scheduler" in window) {
      console.log("[perf] scheduler API available");
    }
    console.log("[perf] idle tasks started");
  });
});