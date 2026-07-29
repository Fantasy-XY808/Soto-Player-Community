/**
 * MusicFree 插件搜索聚合器
 *
 * 没有单一"musicfree 平台"——所有启用 MusicFree 协议的插件都会被并发查询，
 * 结果按 (pluginId, musicItem.id) 去重后合并返回。
 *
 * 关键：转换时同步写入 track.mf 上下文，并调用 setMfContext 把 (pluginId, musicItem)
 * 注册到 musicfree-runtime 的 contextMap。这样切歌时即使 Track 对象被重建（如队列恢复），
 * resolveByMusicFree 仍能从 contextMap 命中原始 musicItem，避免再做一次 search 才能取流。
 */

import type { Track } from "@shared/types/player";
import type { MfMusicItem, MfMediaType } from "@shared/types/plugin";
import { usePluginsStore } from "@/stores/plugins";
import { setMfContext } from "@/services/musicfree-runtime";

/** 单页大小（与官方平台对齐） */
const PAGE_SIZE = 30;

/** 搜索结果 */
export interface MfSearchResult {
  items: Track[];
  total: number;
  hasMore: boolean;
}

/**
 * 把 MfMusicItem 转换为宿主 Track，并注册 mf 上下文
 *
 * @param item - MusicFree 插件返回的 musicItem
 * @param pluginId - 来源插件 ID
 * @returns 宿主 Track，携带 mf 上下文供 resolveByMusicFree 使用
 */
export const mfMusicItemToTrack = (item: MfMusicItem, pluginId: string): Track => {
  const trackId = `${pluginId}:${item.id}`;
  // 同步注册 mf 上下文：track.mf 在队列持久化时可能被剥离，contextMap 是权威源
  setMfContext(trackId, { pluginId, musicItem: item });
  const duration = (item.duration ?? 0) * 1000;
  return {
    id: trackId,
    source: "musicfree",
    title: item.title,
    artists: item.artist
      ? item.artist.split(/[\/,、]/).map((name) => ({ name: name.trim() })).filter((a) => a.name)
      : [],
    album: item.album ? { name: item.album } : undefined,
    cover: item.artwork,
    duration,
    mf: {
      pluginId,
      musicItem: item,
    },
  };
};

/**
 * 并发搜索所有启用的 MusicFree 插件
 *
 * 每个插件独立分页，结果按 pluginId+musicItem.id 去重后合并。
 * 任一插件失败不影响其他插件返回。
 *
 * @param keyword - 搜索关键词
 * @param page - 页码（从 1 开始，传给每个插件）
 * @param type - 搜索类型，默认 "music"
 */
export const searchByMusicFree = async (
  keyword: string,
  page = 1,
  type: MfMediaType = "music",
): Promise<MfSearchResult> => {
  const plugins = usePluginsStore();
  const candidates = plugins.musicfreePlugins.filter(
    (info) => info.enabled && info.status.state === "ready",
  );

  if (candidates.length === 0) {
    return { items: [], total: 0, hasMore: false };
  }

  const results = await Promise.allSettled(
    candidates.map(async (info) => {
      try {
        const res = await window.api.plugins.mfSearch(
          info.manifest.id,
          keyword,
          page,
          type,
        );
        return { pluginId: info.manifest.id, items: (res.data ?? []) as MfMusicItem[], isEnd: res.isEnd };
      } catch (err) {
        console.warn("[musicfree] search failed", info.manifest.id, err);
        return { pluginId: info.manifest.id, items: [], isEnd: true };
      }
    }),
  );

  const seen = new Set<string>();
  const tracks: Track[] = [];
  let anyHasMore = false;
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const { pluginId, items, isEnd } = r.value;
    if (!isEnd) anyHasMore = true;
    for (const item of items) {
      if (type !== "music") continue;
      const key = `${pluginId}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(mfMusicItemToTrack(item as MfMusicItem, pluginId));
    }
  }

  // 估算总数：当前页结果数 + 是否还有更多
  // 真实 total 需要插件层支持，这里用 hasMore 表达分页状态
  return {
    items: tracks,
    total: tracks.length,
    hasMore: anyHasMore,
  };
};

/**
 * 取启用的 MusicFree 插件数量（UI 用于显示空态）
 */
export const getEnabledMusicFreePluginCount = (): number => {
  const plugins = usePluginsStore();
  return plugins.musicfreePlugins.filter(
    (info) => info.enabled && info.status.state === "ready",
  ).length;
};

/** 与官方平台 searchSongs 接口对齐的 PAGE_SIZE 导出 */
export const MUSICFREE_PAGE_SIZE = PAGE_SIZE;
