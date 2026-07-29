<script setup lang="ts">
/**
 * 视频渲染窗口根组件
 *
 * 挂载 <FullPlayer /> 视觉层，复用主播放界面的全部视觉元素：
 * - 封面（含视差/呼吸/调色板提取）
 * - 歌词（含逐字高亮/弹簧动画/扇形布局）
 * - 频谱（含 FFT 驱动/等响度补偿/呼吸心跳）
 * - 流体背景（含 WebGL 加速/节拍脉动/几何纹理）
 * - 液态玻璃控件 / 雪花 / 雾气 / 雨滴 / 纯音乐热评
 *
 * 渲染窗口离屏（show:false），用户不可见。逐帧通过 captureFrame IPC
 * 将 FullPlayer 真实 DOM 渲染截图喂给 MediaRecorder，保证"所见即所得"。
 *
 * 强制 isExpanded=true：在 setup 阶段写入，先于 FullPlayer 挂载，
 * 避免初始 mount 时 <Transition> 播放入场动画（视频首帧不应有滑入效果）。
 */

import { onBeforeUnmount, onMounted } from "vue";
import { useStatusStore } from "@/stores/status";
import FullPlayer from "@/components/player/FullPlayer/index.vue";
import { useRenderBootstrap } from "./composables/useRenderBootstrap";
import { useRenderCapture } from "./composables/useRenderCapture";

// 强制展开播放界面 —— 必须在 FullPlayer 挂载前完成
// setup 阶段写入 → FullPlayer v-show="isExpanded" 初始即为 true → 无入场动画
const status = useStatusStore();
status.isExpanded = true;

const { bootstrap } = useRenderBootstrap();
const { config, errorMessage, startRender, cancelRender } = useRenderCapture();

/** 订阅取消订阅器 */
let unsubConfig: (() => void) | null = null;
let unsubCancel: (() => void) | null = null;

onMounted(() => {
  // eslint-disable-next-line no-console
  console.info("[ERR-70003-I] 渲染窗口 onMounted 开始订阅");

  // 订阅主进程下发的渲染配置
  unsubConfig = window.api.renderVideo.onConfig((cfg) => {
    // eslint-disable-next-line no-console
    console.info(
      `[ERR-70003-J] 收到 config 事件 taskId=${cfg.taskId} track=${cfg.track.title}`,
    );
    // 先引导初始化（应用设置快照 / 写入 track+lyrics / 启用本地 FFT）
    bootstrap(cfg);
    // 再启动捕获（创建 audio / AudioContext / canvas / MediaRecorder）
    void startRender(cfg);
  });

  // 订阅取消指令
  unsubCancel = window.api.renderVideo.onCancel(({ taskId }) => {
    // eslint-disable-next-line no-console
    console.info(`[ERR-70003-K] 收到 cancel 事件 taskId=${taskId}`);
    if (config.value?.taskId === taskId) {
      cancelRender();
    }
  });

  // 通知主进程已就绪（订阅已建立）
  // 必须在订阅后发送，否则会错过 config 事件
  window.api.renderVideo.sendReady();
  // eslint-disable-next-line no-console
  console.info("[ERR-70003-L] 已发送 ready 信号");
});

onBeforeUnmount(() => {
  unsubConfig?.();
  unsubCancel?.();
  cancelRender();
});
</script>

<template>
  <!-- FullPlayer 使用 <Teleport to="body">，自身挂载点不影响其渲染位置 -->
  <!-- 强制 isExpanded=true 后 FullPlayer 永远可见，由 captureFrame 逐帧截图 -->
  <FullPlayer />
  <!-- 错误浮层：仅渲染失败时显示，不影响 FullPlayer 渲染 -->
  <div v-if="errorMessage" class="error-overlay">错误：{{ errorMessage }}</div>
</template>

<style scoped>
.error-overlay {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  padding: 8px 16px;
  background: rgba(248, 113, 113, 0.9);
  color: #fff;
  font-size: 14px;
  font-family: system-ui, sans-serif;
  border-radius: 6px;
  pointer-events: none;
}
</style>
