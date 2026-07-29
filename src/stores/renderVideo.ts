/**
 * 视频渲染全局进度 store
 *
 * 独立于 RenderVideoDialog 生命周期，让主窗口在 dialog 关闭后仍能展示渲染进度。
 *
 * 订阅来源：window.api.renderVideo.onProgress / onState / onFinished / onFailed
 * - onProgress：高频更新（200ms），仅更新当前曲目的 renderedMs
 * - onState：低频状态变更（queued/rendering/done/failed）
 * - onFinished / onFailed：任务终态，触发 toast 通知
 */

import { defineStore } from "pinia";
import type {
  RenderVideoTask,
  RenderVideoProgress,
} from "@shared/types/renderVideo";
import { toast } from "@/composables/useToast";
import i18n from "@/i18n";

/** i18n 全局 t 函数（store 非 setup 上下文，无法用 useI18n） */
const t = i18n.global.t.bind(i18n.global);

interface State {
  /** 所有任务（含历史），按 createdAt 倒序 */
  tasks: RenderVideoTask[];
  /** 当前正在渲染的任务 ID（无则 null） */
  activeTaskId: string | null;
  /** 是否已注册 IPC 订阅 */
  subscribed: boolean;
}

const SUBSCRIBERS: Array<() => void> = [];

export const useRenderVideoStore = defineStore("renderVideo", {
  state: (): State => ({
    tasks: [],
    activeTaskId: null,
    subscribed: false,
  }),

  getters: {
    /** 当前活跃任务对象 */
    activeTask(state): RenderVideoTask | null {
      if (!state.activeTaskId) return null;
      return state.tasks.find((t) => t.taskId === state.activeTaskId) ?? null;
    },
    /** 是否有任务正在渲染/排队 */
    hasActive(state): boolean {
      return state.tasks.some(
        (t) =>
          t.status === "queued" ||
          t.status === "preparing" ||
          t.status === "rendering" ||
          t.status === "muxing",
      );
    },
    /** 活跃任务数（用于 UI 角标） */
    activeCount(state): number {
      return state.tasks.filter(
        (t) =>
          t.status === "queued" ||
          t.status === "preparing" ||
          t.status === "rendering" ||
          t.status === "muxing",
      ).length;
    },
    /** 当前任务进度百分比（0-100） */
    activeProgressPercent(state): number {
      const task = state.tasks.find((t) => t.taskId === state.activeTaskId);
      if (!task || task.currentDurationMs <= 0) return 0;
      const currentRatio = Math.min(1, task.renderedMs / task.currentDurationMs);
      const totalRatio =
        task.total > 0
          ? (task.currentIndex + currentRatio) / task.total
          : currentRatio;
      return Math.round(totalRatio * 100);
    },
  },

  actions: {
    /** 注册 IPC 订阅（幂等，仅注册一次） */
    subscribe(): void {
      if (this.subscribed) return;
      this.subscribed = true;

      SUBSCRIBERS.push(
        window.api.renderVideo.onProgress((data: RenderVideoProgress) => {
          this.applyProgress(data);
        }),
      );
      SUBSCRIBERS.push(
        window.api.renderVideo.onState((task: RenderVideoTask) => {
          this.applyState(task);
        }),
      );
      SUBSCRIBERS.push(
        window.api.renderVideo.onFinished(({ taskId, filePath }) => {
          this.applyFinished(taskId, filePath);
        }),
      );
      SUBSCRIBERS.push(
        window.api.renderVideo.onFailed(({ taskId, error }) => {
          this.applyFailed(taskId, error);
        }),
      );
    },

    /** 注销订阅（一般不需要，除非热重载） */
    unsubscribeAll(): void {
      SUBSCRIBERS.splice(0, SUBSCRIBERS.length).forEach((fn) => fn());
      this.subscribed = false;
    },

    /** 拉取主进程任务列表（用于初始化） */
    async refreshTasks(): Promise<void> {
      try {
        const list = await window.api.renderVideo.list();
        this.tasks = list;
        const active = list.find(
          (t) =>
            t.status === "queued" ||
            t.status === "preparing" ||
            t.status === "rendering" ||
            t.status === "muxing",
        );
        this.activeTaskId = active?.taskId ?? null;
      } catch (err) {
        console.warn("[renderVideoStore] refreshTasks failed", err);
      }
    },

    applyProgress(data: RenderVideoProgress): void {
      const idx = this.tasks.findIndex((t) => t.taskId === data.taskId);
      if (idx < 0) return;
      const task = this.tasks[idx]!;
      task.status = data.status;
      task.currentIndex = data.currentIndex;
      task.total = data.total;
      task.renderedMs = data.renderedMs;
      task.currentDurationMs = data.currentDurationMs;
      // 触发响应式（数组元素属性变更需显式赋值）
      this.tasks.splice(idx, 1, { ...task });
    },

    applyState(task: RenderVideoTask): void {
      const idx = this.tasks.findIndex((t) => t.taskId === task.taskId);
      if (idx >= 0) {
        this.tasks.splice(idx, 1, { ...task });
      } else {
        this.tasks.unshift({ ...task });
      }
      const isActive =
        task.status === "queued" ||
        task.status === "preparing" ||
        task.status === "rendering" ||
        task.status === "muxing";
      if (isActive) {
        this.activeTaskId = task.taskId;
      } else if (this.activeTaskId === task.taskId) {
        this.activeTaskId = null;
      }
    },

    applyFinished(taskId: string, filePath: string): void {
      const idx = this.tasks.findIndex((t) => t.taskId === taskId);
      if (idx >= 0) {
        const task = this.tasks[idx]!;
        task.status = "done";
        task.filePath = filePath;
        task.finishedAt = Date.now();
        this.tasks.splice(idx, 1, { ...task });
      }
      if (this.activeTaskId === taskId) {
        this.activeTaskId = null;
      }
      // 全局 toast 通知（不依赖 dialog 是否打开）
      try {
        toast.success(t("renderVideo.toast.finished"));
      } catch {
        // i18n 未就绪时忽略
      }
    },

    applyFailed(taskId: string, error: string): void {
      const idx = this.tasks.findIndex((t) => t.taskId === taskId);
      if (idx >= 0) {
        const task = this.tasks[idx]!;
        task.status = "failed";
        task.error = error;
        task.finishedAt = Date.now();
        this.tasks.splice(idx, 1, { ...task });
      }
      if (this.activeTaskId === taskId) {
        this.activeTaskId = null;
      }
      // 全局 toast 通知
      try {
        toast.error(`${t("renderVideo.toast.failed")}: ${error}`);
      } catch {
        // i18n 未就绪时忽略
      }
    },

    /** 清理已结束的任务（保留最近 N 条历史） */
    cleanup(keepCount = 20): void {
      if (this.tasks.length <= keepCount) return;
      this.tasks.splice(keepCount);
    },
  },
});
