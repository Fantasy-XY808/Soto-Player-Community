<script setup lang="ts">
import { useLogsViewer } from "@/composables/useLogsViewer";
import { useDebounceFn } from "@vueuse/core";
import { toast } from "@/composables/useToast";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideCopy from "~icons/lucide/copy";
import IconLucideFolderOpen from "~icons/lucide/folder-open";
import IconLucidePencil from "~icons/lucide/pencil";
import IconLucideTrash2 from "~icons/lucide/trash-2";
import IconLucideCheck from "~icons/lucide/check";
import IconLucideX from "~icons/lucide/x";

const dialog = useLogsViewer();
const { open } = dialog;
const { t } = useI18n();

interface LogFileMeta {
  name: string;
  size: number;
  mtime: number;
}

const logs = ref<LogFileMeta[]>([]);
const selected = ref<string | null>(null);
const content = ref<string>("");
const truncated = ref(false);
const totalBytes = ref(0);
const loading = ref(false);
const error = ref<string | null>(null);
/** 日志级别过滤："all" 表示全部（避免 reka-ui SelectItem 空字符串断言错误） */
const levelFilter = ref<"all" | "error" | "warn" | "info" | "debug">("all");
/** 关键字过滤（实时 debounce） */
const keyword = ref("");
const keywordDebounced = ref("");
const autoScroll = ref(true);
/** 内容容器引用，用于自动滚动到底部 */
const contentEl = ref<HTMLElement | null>(null);

/** 重命名状态 */
const renaming = ref<string | null>(null);
const renameInput = ref("");
/** 操作确认状态：删除前要求二次确认 */
const confirmingDelete = ref<string | null>(null);

/** 关键字 debounce 300ms，避免逐字符过滤全量日志 */
const applyKeyword = useDebounceFn(() => {
  keywordDebounced.value = keyword.value.trim().toLowerCase();
}, 300);
watch(keyword, () => applyKeyword());

/** 格式化文件大小 */
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

/** 格式化时间戳 */
const formatTime = (ms: number): string => {
  const d = new Date(ms);
  return d.toLocaleString();
};

/** 当日日志文件名 YYYY-MM-DD.log */
const todayLogName = (): string => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}.log`;
};

/** 刷新日志文件列表 */
const refreshLogs = async (): Promise<void> => {
  try {
    logs.value = await window.api.system.listLogs();
    // 默认选中今日日志；不存在则取首个
    const target = dialog.initialLogFile.value ?? todayLogName();
    const exists = logs.value.some((log) => log.name === target);
    selected.value = exists ? target : (logs.value[0]?.name ?? null);
  } catch (err) {
    error.value = String(err);
  }
};

/** 加载选中日志文件内容 */
const loadContent = async (): Promise<void> => {
  if (!selected.value) {
    content.value = "";
    truncated.value = false;
    totalBytes.value = 0;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const result = await window.api.system.readLog(selected.value);
    content.value = result.content;
    truncated.value = result.truncated;
    totalBytes.value = result.totalBytes;
    // 切换文件后滚动到底部
    await nextTick();
    if (autoScroll.value && contentEl.value) {
      contentEl.value.scrollTop = contentEl.value.scrollHeight;
    }
  } catch (err) {
    error.value = String(err);
    content.value = "";
  } finally {
    loading.value = false;
  }
};

/** 解析单行日志的级别（用于彩色高亮） */
const detectLevel = (line: string): "error" | "warn" | "info" | "debug" | "default" => {
  const lower = line.toLowerCase();
  // electron-log 默认格式：[ISO时间] [level] [scope] message
  // 也兼容 console 重定向后的格式
  if (lower.includes("[error]") || lower.includes(" error ") || lower.includes("error:")) {
    return "error";
  }
  if (lower.includes("[warn]") || lower.includes(" warn ") || lower.includes("warning:")) {
    return "warn";
  }
  if (lower.includes("[debug]") || lower.includes(" debug ")) {
    return "debug";
  }
  if (lower.includes("[info]") || lower.includes(" info ")) {
    return "info";
  }
  return "default";
};

/** 过滤后的日志行（带级别标注，便于模板渲染彩色） */
interface LogLine {
  text: string;
  level: "error" | "warn" | "info" | "debug" | "default";
}
const filteredLines = computed<LogLine[]>(() => {
  if (!content.value) return [];
  const lines = content.value.split(/\r?\n/);
  const kw = keywordDebounced.value;
  const level = levelFilter.value;
  return lines
    .map((text) => ({ text, level: detectLevel(text) }))
    .filter(({ text, level: lineLevel }) => {
      // 级别过滤：all 表示不过滤；其他值严格匹配
      if (level !== "all" && lineLevel !== level) {
        return false;
      }
      if (kw && !text.toLowerCase().includes(kw)) return false;
      return true;
    });
});

/** 选中文件或过滤器变化时重新加载内容（仅文件变化才重新请求 IPC） */
watch(selected, () => {
  void loadContent();
});

/** 弹窗打开时刷新列表 */
watch(open, (v) => {
  if (v) {
    void refreshLogs();
  } else {
    // 关闭时清理：避免下次打开瞬间显示旧内容
    content.value = "";
    keyword.value = "";
    keywordDebounced.value = "";
    levelFilter.value = "all";
    renaming.value = null;
    confirmingDelete.value = null;
  }
});

/** 自动滚动开关变化或新内容到达时滚动到底部 */
watch(autoScroll, async (v) => {
  if (v) {
    await nextTick();
    if (contentEl.value) contentEl.value.scrollTop = contentEl.value.scrollHeight;
  }
});

/** 选中条目 */
const onSelect = (name: string): void => {
  // 切换文件前取消任何重命名/删除态
  renaming.value = null;
  confirmingDelete.value = null;
  selected.value = name;
};

/** 复制全部内容到剪贴板 */
const copyAll = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(content.value);
    toast.success(t("logs.copySuccess"));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    toast.error(`${t("logs.copyFailed")}: ${reason}`);
  }
};

/**
 * 全选日志内容（Ctrl+A / Cmd+A 快捷键）
 *
 * 限定范围在 contentEl 内，避免 Ctrl+A 选中整个文档（侧边栏、工具栏等无关文本）。
 * 选中后用户可使用浏览器原生 Ctrl+C / 右键菜单复制（容器已通过 select-text 强制允许文本选择）。
 */
const selectAll = (): void => {
  if (!contentEl.value) return;
  contentEl.value.focus();
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(contentEl.value);
  selection.removeAllRanges();
  selection.addRange(range);
};

/** 在文件管理器中显示 */
const openInExplorer = async (): Promise<void> => {
  await window.api.system.openLogsDir();
};

/** 刷新当前文件内容 */
const refresh = (): void => {
  void loadContent();
};

/** 进入重命名模式 */
const startRename = (name: string): void => {
  renaming.value = name;
  renameInput.value = name;
  confirmingDelete.value = null;
};

/** 取消重命名 */
const cancelRename = (): void => {
  renaming.value = null;
  renameInput.value = "";
};

/** 确认重命名 */
const confirmRename = async (): Promise<void> => {
  if (!renaming.value) return;
  const newName = renameInput.value.trim();
  if (!newName) {
    toast.error(t("logs.renameEmpty"));
    return;
  }
  if (!newName.endsWith(".log")) {
    toast.error(t("logs.renameSuffix"));
    return;
  }
  if (newName === renaming.value) {
    renaming.value = null;
    return;
  }
  const result = await window.api.system.renameLog(renaming.value, newName);
  if (result.success) {
    toast.success(t("logs.renameSuccess"));
    renaming.value = null;
    // 选中保持在新名上
    selected.value = newName;
    await refreshLogs();
  } else {
    toast.error(result.error ?? t("logs.renameFailed"));
  }
};

/** 进入删除确认态 */
const startDelete = (name: string): void => {
  confirmingDelete.value = name;
  renaming.value = null;
};

/** 取消删除 */
const cancelDelete = (): void => {
  confirmingDelete.value = null;
};

/** 确认删除 */
const confirmDelete = async (): Promise<void> => {
  if (!confirmingDelete.value) return;
  const target = confirmingDelete.value;
  const result = await window.api.system.deleteLog(target);
  if (result.success) {
    toast.success(t("logs.deleteSuccess"));
    confirmingDelete.value = null;
    // 删除的是当前选中文件则切到首个
    if (selected.value === target) {
      selected.value = null;
    }
    await refreshLogs();
  } else {
    toast.error(result.error ?? t("logs.deleteFailed"));
    confirmingDelete.value = null;
  }
};
</script>

<template>
  <SDialog
    v-model:open="open"
    width="min(1100px, calc(100vw - 40px))"
    height="80vh"
    :closable="true"
  >
    <div class="flex flex-col h-full">
      <!-- 顶部工具栏 -->
      <!-- 右侧给关闭按钮(absolute top-3 right-3, 约 32px)留出空间 pr-12 -->
      <div
        class="flex items-center gap-2 px-4 py-3 border-b border-solid border-outline-variant/15 shrink-0 pr-12"
      >
        <h2 class="text-base font-medium shrink-0">{{ t("logs.title") }}</h2>
        <div class="flex-1" />
        <SButton
          variant="tertiary"
          size="small"
          :loading="loading"
          :icon-size="14"
          @click="refresh"
        >
          <template #icon><IconLucideRefreshCw /></template>
          <span class="whitespace-nowrap">{{ t("logs.refresh") }}</span>
        </SButton>
        <SButton
          variant="tertiary"
          size="small"
          :disabled="!content"
          :icon-size="14"
          @click="copyAll"
        >
          <template #icon><IconLucideCopy /></template>
          <span class="whitespace-nowrap">{{ t("logs.copy") }}</span>
        </SButton>
        <SButton
          variant="tertiary"
          size="small"
          :icon-size="14"
          @click="openInExplorer"
        >
          <template #icon><IconLucideFolderOpen /></template>
          <span class="whitespace-nowrap">{{ t("logs.openInExplorer") }}</span>
        </SButton>
      </div>

      <!-- 主体：左侧文件列表 + 右侧内容 -->
      <div class="flex-1 flex min-h-0">
        <!-- 左侧：日志文件列表 -->
        <!-- 使用 surface-panel 主题色 + 边框，与设置弹窗侧栏风格一致 -->
        <aside
          class="w-60 shrink-0 border-r border-solid border-outline-variant/15 overflow-y-auto bg-surface-panel/30"
        >
          <div
            v-if="logs.length === 0"
            class="p-4 text-sm text-on-surface-variant/60 text-center"
          >
            {{ t("logs.empty") }}
          </div>
          <ul v-else class="py-1">
            <li
              v-for="log in logs"
              :key="log.name"
              :class="[
                'group relative px-3 py-2 cursor-pointer text-sm transition-colors border-b border-solid border-outline-variant/5',
                selected === log.name
                  ? 'bg-primary/15 text-primary'
                  : 'hover:bg-surface-variant/30 text-on-surface-variant',
              ]"
              @click="onSelect(log.name)"
            >
              <!-- 重命名模式 -->
              <div v-if="renaming === log.name" class="flex items-center gap-1" @click.stop>
                <input
                  v-model="renameInput"
                  class="flex-1 min-w-0 bg-surface-alt border border-solid border-outline-variant rounded px-1.5 py-0.5 text-xs focus:border-primary focus:outline-none"
                  @keyup.enter="confirmRename"
                  @keyup.esc="cancelRename"
                />
                <button
                  class="shrink-0 size-6 flex items-center justify-center rounded bg-transparent hover:bg-primary/20 text-primary"
                  :title="t('logs.confirmRename')"
                  @click="confirmRename"
                >
                  <IconLucideCheck class="size-3.5" />
                </button>
                <button
                  class="shrink-0 size-6 flex items-center justify-center rounded bg-transparent hover:bg-surface-variant/50 text-on-surface-variant"
                  :title="t('logs.cancelRename')"
                  @click="cancelRename"
                >
                  <IconLucideX class="size-3.5" />
                </button>
              </div>
              <!-- 删除确认模式 -->
              <div
                v-else-if="confirmingDelete === log.name"
                class="flex flex-col gap-1.5"
                @click.stop
              >
                <div class="text-xs text-red-600 dark:text-red-400">{{ t("logs.deleteConfirm") }}</div>
                <div class="flex items-center gap-1">
                  <button
                    class="flex-1 px-2 py-0.5 text-xs rounded bg-red-500/15 text-red-600 dark:text-red-400 hover:bg-red-500/25 dark:hover:bg-red-400/25"
                    @click="confirmDelete"
                  >
                    {{ t("logs.delete") }}
                  </button>
                  <button
                    class="px-2 py-0.5 text-xs rounded bg-transparent hover:bg-surface-variant/50 text-on-surface-variant"
                    @click="cancelDelete"
                  >
                    {{ t("logs.cancelRename") }}
                  </button>
                </div>
              </div>
              <!-- 默认显示 -->
              <template v-else>
                <div class="font-mono text-xs truncate pr-12">{{ log.name }}</div>
                <div class="text-xs text-on-surface-variant/60 mt-0.5">
                  {{ formatSize(log.size) }} · {{ formatTime(log.mtime) }}
                </div>
                <!-- 悬浮操作按钮组（右侧） -->
                <div
                  class="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-surface-panel/80 backdrop-blur-sm rounded"
                >
                  <button
                    class="size-6 flex items-center justify-center rounded bg-transparent hover:bg-primary/20 text-primary"
                    :title="t('logs.rename')"
                    @click.stop="startRename(log.name)"
                  >
                    <IconLucidePencil class="size-3.5" />
                  </button>
                  <button
                    class="size-6 flex items-center justify-center rounded bg-transparent hover:bg-red-500/20 dark:hover:bg-red-400/20 text-red-600 dark:text-red-400"
                    :title="t('logs.delete')"
                    @click.stop="startDelete(log.name)"
                  >
                    <IconLucideTrash2 class="size-3.5" />
                  </button>
                </div>
              </template>
            </li>
          </ul>
        </aside>

        <!-- 右侧：日志内容 -->
        <div class="flex-1 flex flex-col min-w-0">
          <!-- 过滤栏 -->
          <div
            class="flex items-center gap-2 px-3 py-2 border-b border-solid border-outline-variant/15 shrink-0"
          >
            <SInput
              v-model="keyword"
              :placeholder="t('logs.keywordPlaceholder')"
              size="small"
              class="flex-1"
            />
            <SSelect
              v-model="levelFilter"
              :options="[
                { label: t('logs.levelAll'), value: 'all' },
                { label: t('logs.levelError'), value: 'error' },
                { label: t('logs.levelWarn'), value: 'warn' },
                { label: t('logs.levelInfo'), value: 'info' },
                { label: t('logs.levelDebug'), value: 'debug' },
              ]"
              class="w-32"
            />
            <SButton
              :variant="autoScroll ? 'filled' : 'tertiary'"
              size="small"
              :title="t('logs.autoScrollHint')"
              @click="autoScroll = !autoScroll"
            >
              <span class="whitespace-nowrap">{{ t("logs.autoScroll") }}</span>
            </SButton>
          </div>

          <!-- 截断提示 -->
          <div
            v-if="truncated"
            class="px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 dark:bg-amber-400/10 border-b border-solid border-amber-500/20 dark:border-amber-400/20 shrink-0"
          >
            {{ t("logs.truncatedHint", { mb: (totalBytes / 1024 / 1024).toFixed(2) }) }}
          </div>

          <!-- 内容区域：用户可选中文本复制 -->
          <!-- 字体用系统等宽（不强制点阵），彩色级别高亮 -->
          <!-- bg-surface-alt/40 + backdrop-blur 让日志区域与表面色协调（液态玻璃主题下也能融合） -->
          <div
            ref="contentEl"
            class="flex-1 overflow-auto px-3 py-2 bg-surface-alt/50 select-text [&_*]:select-text"
            style="user-select: text; -webkit-user-select: text; cursor: text"
            @keydown.ctrl.a.prevent="selectAll"
            @keydown.meta.a.prevent="selectAll"
            tabindex="0"
          >
            <div v-if="error" class="text-red-600 dark:text-red-400 p-2">{{ error }}</div>
            <div v-else-if="loading" class="text-on-surface-variant/60 p-2">
              {{ t("logs.loading") }}
            </div>
            <div
              v-else-if="filteredLines.length > 0"
              class="font-mono text-xs leading-relaxed whitespace-pre-wrap break-all"
            >
              <div
                v-for="(line, idx) in filteredLines"
                :key="`${line.text.slice(0, 32)}-${idx}`"
                :class="[
                  line.level === 'error' && 'text-red-600 dark:text-red-400',
                  line.level === 'warn' && 'text-amber-600 dark:text-amber-400',
                  line.level === 'info' && 'text-sky-700 dark:text-sky-300',
                  line.level === 'debug' && 'text-on-surface-variant/70',
                  line.level === 'default' && 'text-on-surface/90',
                ]"
              >
                {{ line.text }}
              </div>
            </div>
            <div v-else class="text-on-surface-variant/60 p-2">{{ t("logs.noMatch") }}</div>
          </div>
        </div>
      </div>
    </div>
  </SDialog>
</template>
