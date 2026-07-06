/**
 * 文档可见性暂停
 *
 * 监听 document.visibilitychange：hidden 时暂停共享 RAF 与 FFT 推送，
 * visible 时恢复。RAF 调度器自身已对 visibilitychange 做了停止处理，
 * 但显式调用 pauseAllRaf 还会设置 paused 标志，避免任何消费者在 hidden 期间被
 * 重新订阅时意外重启 RAF 循环。FFT 推送的后端开关则需在此处显式联动。
 *
 * 该 composable 是模块级单例，多次调用共享同一个监听器；通常只在 main.ts 调用一次。
 */
import { pauseAllRaf, resumeAllRaf } from "@/services/rafScheduler";
import { forcePauseFft, resumeFromForcePause } from "@/services/fftCapture";

let installed = false;

const onHidden = (): void => {
  pauseAllRaf();
  forcePauseFft();
};

const onVisible = (): void => {
  resumeAllRaf();
  resumeFromForcePause();
};

const install = (): void => {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) onHidden();
    else onVisible();
  });
};

/** 接入全局 visibilitychange 暂停/恢复 */
export const useVisibilityPause = (): void => {
  install();
};
