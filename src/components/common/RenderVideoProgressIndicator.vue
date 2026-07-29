<script setup lang="ts">
/**
 * 视频渲染进度常驻指示器
 *
 * 渲染任务存在时显示在主窗口右下角，展示：
 * - 当前曲目信息（标题 + 艺人 + 索引）
 * - 进度条（0-100%）
 * - 状态文案（queued/rendering/...）
 * - 取消按钮
 *
 * 点击指示器主体可重新打开 RenderVideoDialog 查看完整任务列表。
 */
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useRenderVideoStore } from "@/stores/renderVideo";
import { useRenderVideoDialog } from "@/composables/useRenderVideoDialog";
import { useI18n } from "vue-i18n";
import { toast } from "@/composables/useToast";
import IconVideo from "~icons/lucide/video";
import IconX from "~icons/lucide/x";
import IconLoader from "~icons/lucide/loader-2";

const { t } = useI18n();
const store = useRenderVideoStore();
const dialog = useRenderVideoDialog();

/** 当前活跃任务 */
const activeTask = computed(() => store.activeTask);

/** 进度百分比（0-100） */
const percent = computed(() => store.activeProgressPercent);

/** 是否显示指示器 */
const visible = computed(() => store.hasActive);

/** 状态文案 */
const statusText = computed(() => {
  const task = activeTask.value;
  if (!task) return "";
  return t(`renderVideo.status.${task.status}`);
});

/** 已渲染时长 / 总时长（mm:ss） */
const renderedTime = computed(() => {
  const task = activeTask.value;
  if (!task) return "0:00 / 0:00";
  return `${formatTime(task.renderedMs)} / ${formatTime(task.currentDurationMs)}`;
});

/** 时间格式化 mm:ss */
const formatTime = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/** 取消当前任务 */
const onCancel = async (): Promise<void> => {
  const task = activeTask.value;
  if (!task) return;
  try {
    await window.api.renderVideo.cancel(task.taskId);
    toast.info(t("renderVideo.toast.canceled"));
  } catch (err) {
    console.warn("[RenderVideoProgressIndicator] cancel failed", err);
  }
};

/** 点击主体重新打开 dialog */
const onClick = (): void => {
  dialog.show({ tracks: [], mode: "single" });
};

onMounted(() => {
  store.subscribe();
  void store.refreshTasks();
});

onBeforeUnmount(() => {
  // 保持订阅全局活跃，组件销毁不注销
});
</script>

<template>
  <Transition name="rv-slide">
    <div
      v-if="visible"
      class="fixed bottom-4 right-4 z-40 w-80 rounded-xl border border-outline-variant/30 bg-surface/95 shadow-lg backdrop-blur-md dark:bg-surface-dark/95"
    >
      <!-- 顶部：图标 + 标题 + 关闭 -->
      <div class="flex items-center gap-2 px-3 py-2.5">
        <div class="relative">
          <IconVideo class="w-4 h-4 text-primary" />
          <IconLoader
            v-if="activeTask?.status === 'rendering' || activeTask?.status === 'muxing'"
            class="absolute -top-1 -right-1 w-2.5 h-2.5 text-primary animate-spin"
          />
        </div>
        <span class="text-sm font-medium text-on-surface flex-1 truncate">
          {{ t("renderVideo.indicator.title") }}
        </span>
        <span class="text-xs text-on-surface-variant/70 tabular-nums">
          {{ percent }}%
        </span>
      </div>

      <!-- 中部：进度条 -->
      <button
        type="button"
        class="w-full px-3 pb-2 text-left group"
        @click="onClick"
      >
        <div class="w-full h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
          <div
            class="h-full bg-primary transition-[width] duration-200 ease-out group-hover:bg-primary/80"
            :style="{ width: `${percent}%` }"
          />
        </div>
        <div class="mt-1.5 flex items-center justify-between text-xs text-on-surface-variant/70">
          <span class="truncate">{{ statusText }}</span>
          <span class="tabular-nums shrink-0 ml-2">{{ renderedTime }}</span>
        </div>
      </button>

      <!-- 底部：取消按钮 -->
      <div class="flex justify-end px-3 pb-2.5">
        <button
          type="button"
          class="text-xs text-on-surface-variant/70 hover:text-error transition-colors flex items-center gap-1"
          @click="onCancel"
        >
          <IconX class="w-3 h-3" />
          {{ t("renderVideo.indicator.cancel") }}
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.rv-slide-enter-active,
.rv-slide-leave-active {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
}
.rv-slide-enter-from,
.rv-slide-leave-to {
  transform: translateY(120%);
  opacity: 0;
}
</style>
