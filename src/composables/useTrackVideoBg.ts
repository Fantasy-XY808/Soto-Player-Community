import { bilibiliCall } from "@/apis/bilibili";
import localforage from "localforage";
import { shallowRef } from "vue";

/** 视频来源 */
export type TrackVideoSource = "bilibili" | "custom";

/** 按歌曲配置的视频背景信息 */
export interface TrackVideoBgItem {
  /** 视频流地址 */
  videoUrl: string;
  /** 视频来源 */
  source: TrackVideoSource;
  /** 视频标题 */
  title: string;
  /** Bilibili BV 号 */
  bvid?: string;
  /** Bilibili 视频 cid */
  cid?: number;
}

/** 按歌曲配置的视频背景存储 */
const db = localforage.createInstance({ name: "splayer", storeName: "trackVideoBg" });

/** 视频背景配置变更事件目标（跨组件通知：保存/删除后立即刷新播放器背景） */
const changeEvents = new EventTarget();

/** 视频背景配置变更事件名 */
const VIDEO_BG_CHANGE_EVENT = "track-video-bg-change";

/**
 * 派发视频背景配置变更事件
 * @param trackId - 发生变更的歌曲 id
 */
const emitVideoBgChange = (trackId: string): void => {
  changeEvents.dispatchEvent(new CustomEvent(VIDEO_BG_CHANGE_EVENT, { detail: trackId }));
};

/**
 * 订阅视频背景配置变更
 * @param handler - 变更回调，参数为发生变更的歌曲 id
 * @returns 取消订阅函数
 */
export const onTrackVideoBgChange = (handler: (trackId: string) => void): (() => void) => {
  const listener = (event: Event): void => {
    handler((event as CustomEvent<string>).detail);
  };
  changeEvents.addEventListener(VIDEO_BG_CHANGE_EVENT, listener);
  return () => changeEvents.removeEventListener(VIDEO_BG_CHANGE_EVENT, listener);
};

/**
 * 校验持久化的视频背景配置
 * @param value - IndexedDB 读取结果
 * @returns 是否为有效的视频背景配置
 */
const isTrackVideoBgItem = (value: unknown): value is TrackVideoBgItem => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.videoUrl === "string" &&
    (item.source === "bilibili" || item.source === "custom") &&
    typeof item.title === "string" &&
    (item.bvid === undefined || typeof item.bvid === "string") &&
    (item.cid === undefined || (typeof item.cid === "number" && Number.isFinite(item.cid)))
  );
};

/** Bilibili playurl 响应（取 DASH 视频流 baseUrl） */
interface BiliPlayurlResponse {
  code?: number;
  data?: {
    cid?: number;
    pages?: Array<{ cid?: number }>;
    dash?: {
      video?: Array<{ id?: number; baseUrl?: string; base_url?: string; backupUrl?: string[] }>;
    };
  };
}

/**
 * 从 Bilibili 解析 BV 号到视频流地址
 *
 * 走主进程 `bilibili.song_url` 模块复用其 BV→cid→playurl 通路，
 * 取 DASH 视频流 baseUrl 作为视频背景。
 * @param bvid - Bilibili BV 号
 * @param cid - 视频 cid（可选，缺省时由主进程取首个分 P）
 * @returns 视频流 URL；解析失败返回空串
 */
export const getVideoUrl = async (bvid: string, cid?: number): Promise<string> => {
  try {
    const resp = await bilibiliCall<BiliPlayurlResponse>("song_url", {
      trackId: bvid,
      cid,
    });
    const video = resp?.data?.dash?.video?.[0];
    return video?.baseUrl || video?.base_url || video?.backupUrl?.[0] || "";
  } catch (err) {
    console.warn("[useTrackVideoBg] getVideoUrl failed:", err);
    return "";
  }
};

/**
 * 获取指定歌曲的视频背景配置
 * @param trackId - 歌曲全局 id
 * @returns 视频背景配置，不存在时返回 null
 */
export const getTrackVideoBg = async (trackId: string): Promise<TrackVideoBgItem | null> => {
  const value = await db.getItem<unknown>(trackId);
  return isTrackVideoBgItem(value) ? value : null;
};

/**
 * 设置指定歌曲的视频背景配置
 * @param trackId - 歌曲全局 id
 * @param item - 视频背景信息
 */
export const setTrackVideoBg = async (
  trackId: string,
  item: TrackVideoBgItem,
): Promise<void> => {
  await db.setItem(trackId, item);
  emitVideoBgChange(trackId);
};

/**
 * 移除指定歌曲的视频背景配置
 * @param trackId - 歌曲全局 id
 */
export const removeTrackVideoBg = async (trackId: string): Promise<void> => {
  await db.removeItem(trackId);
  emitVideoBgChange(trackId);
};

/**
 * 获取所有已配置的视频背景（按歌曲 id 映射）
 * @returns 只读 Map
 */
export const getAllTrackVideoBgs = async (): Promise<ReadonlyMap<string, TrackVideoBgItem>> => {
  const items = new Map<string, TrackVideoBgItem>();
  await db.iterate<unknown, void>((value, key) => {
    if (isTrackVideoBgItem(value)) items.set(key, value);
  });
  return items;
};

/**
 * 检查指定歌曲是否已配置视频背景
 * @param trackId - 歌曲全局 id
 * @returns 是否已配置
 */
export const hasTrackVideoBg = async (trackId: string): Promise<boolean> => {
  return (await getTrackVideoBg(trackId)) !== null;
};

/**
 * 清空全部按歌曲配置的视频背景
 */
export const clearAllTrackVideoBgs = async (): Promise<void> => {
  await db.clear();
};

/**
 * 刷新指定歌曲的视频背景 URL（Bilibili 来源时重新获取 DASH 流）
 * @param trackId - 歌曲全局 id
 * @returns 刷新后的配置，无法刷新时返回 null
 */
export const refreshTrackVideoBg = async (trackId: string): Promise<TrackVideoBgItem | null> => {
  const current = await getTrackVideoBg(trackId);
  if (!current || current.source !== "bilibili" || !current.bvid) return null;
  try {
    const videoUrl = await getVideoUrl(current.bvid, current.cid);
    if (!videoUrl) return null;
    const updated = { ...current, videoUrl };
    await setTrackVideoBg(trackId, updated);
    return updated;
  } catch (err) {
    console.warn("[useTrackVideoBg] refresh failed:", err);
    return null;
  }
};

/**
 * 按歌曲配置视频背景的组合式函数
 * 提供响应式当前歌曲视频背景及 CRUD 操作
 */
export const useTrackVideoBg = () => {
  /** 当前歌曲的视频背景（响应式） */
  const currentTrackVideoBg = shallowRef<TrackVideoBgItem | null>(null);

  /**
   * 加载指定歌曲的视频背景配置
   * @param trackId - 歌曲全局 id
   */
  const loadTrackVideoBg = async (trackId: string): Promise<void> => {
    currentTrackVideoBg.value = await getTrackVideoBg(trackId);
  };

  /**
   * 设置当前歌曲的视频背景配置
   * @param trackId - 歌曲全局 id
   * @param item - 视频背景信息
   */
  const saveTrackVideoBg = async (trackId: string, item: TrackVideoBgItem): Promise<void> => {
    await setTrackVideoBg(trackId, item);
    currentTrackVideoBg.value = item;
  };

  /**
   * 移除当前歌曲的视频背景配置
   * @param trackId - 歌曲全局 id
   */
  const deleteTrackVideoBg = async (trackId: string): Promise<void> => {
    await removeTrackVideoBg(trackId);
    currentTrackVideoBg.value = null;
  };

  return {
    currentTrackVideoBg,
    loadTrackVideoBg,
    saveTrackVideoBg,
    deleteTrackVideoBg,
  };
};
