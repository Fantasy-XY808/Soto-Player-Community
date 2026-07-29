/**
 * 视频渲染对话框控制
 *
 * 全局单例，提供 show() 方法打开对话框。
 * 持久化字段（format/resolution/fps/mode/renderTransition/videoBitrate）从全局设置 store 读写；
 * 临时字段（open/tracks）由本 composable 持有。
 *
 * 入口：
 * - 右键歌曲菜单 → "渲染为视频"（single 模式）
 * - 批量选择 → "渲染为视频"按钮（merge 模式）
 */

import { computed, toRaw } from "vue";
import type { Track } from "@shared/types/player";
import { useSettingsStore } from "@/stores/settings";

/** 渲染对话框配置 */
export interface RenderVideoDialogConfig {
  /** 待渲染曲目列表（single 模式仅取首项） */
  tracks: Track[];
  /** 渲染模式（覆盖默认设置） */
  mode?: "single" | "merge";
}

const open = ref(false);
/** 使用 shallowRef 避免对 Track 数组做深度 reactive，IPC 传输时可被 structuredClone 克隆 */
const tracks = shallowRef<Track[]>([]);

/**
 * 将 Track 数组剥离为 plain object 数组，避免 Vue reactive proxy 阻塞 IPC 克隆
 * 浅层用 toRaw，嵌套 artists/album 用展开拷贝（IPC 只读这些字段，不持有引用）
 */
const toPlainTracks = (list: readonly Track[]): Track[] =>
  list.map((t) => {
    const raw = toRaw(t);
    return {
      ...raw,
      artists: raw.artists.map((a) => ({ ...toRaw(a) })),
      album: raw.album ? { ...toRaw(raw.album) } : undefined,
    };
  });

export const useRenderVideoDialog = () => {
  const settings = useSettingsStore();
  const cfg = settings.system.renderVideo;

  /** 持久化字段：与全局设置 store 双向绑定 */
  const mode = computed<"single" | "merge">({
    get: () => cfg.mode,
    set: (v) => {
      cfg.mode = v;
    },
  });
  const format = computed<"webm" | "mp4">({
    get: () => cfg.format,
    set: (v) => {
      cfg.format = v;
    },
  });
  const resolution = computed<"720p" | "1080p" | "1440p" | "2160p">({
    get: () => cfg.resolution,
    set: (v) => {
      cfg.resolution = v;
    },
  });
  const fps = computed<24 | 30 | 60>({
    get: () => cfg.fps,
    set: (v) => {
      cfg.fps = v;
    },
  });
  const videoBitrate = computed<number>({
    get: () => cfg.videoBitrate,
    set: (v) => {
      cfg.videoBitrate = v;
    },
  });
  const renderTransition = computed<boolean>({
    get: () => cfg.renderTransition,
    set: (v) => {
      cfg.renderTransition = v;
    },
  });

  return {
    open,
    tracks,
    mode,
    format,
    resolution,
    fps,
    videoBitrate,
    renderTransition,

    /**
     * 打开渲染对话框
     * @param config 待渲染曲目列表与可选模式覆盖
     */
    show: (config: RenderVideoDialogConfig): void => {
      tracks.value = toPlainTracks(config.tracks);
      if (config.mode) {
        cfg.mode = config.mode;
      }
      open.value = true;
    },

    /** 关闭对话框 */
    hide: (): void => {
      open.value = false;
    },
  };
};
