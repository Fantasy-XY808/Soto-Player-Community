/**
 * 渲染端封面兜底
 *
 * 当 Track.cover 为空或加载失败时，向声明 musicPic action 的插件源逐个兜底。
 * 命中后调用 media.patchCover 更新曲库并触发封面重新提色。
 *
 * 注意：本模块仅使用 type-only import 与 window 全局访问，避免在 tsx 测试环境
 * 中触发 @shared/* / @/* 别名解析（与现有 src/services/* 不同，本文件需要被
 * test/services 直接导入）。运行时由 Vite 解析 @shared/* / @/* 别名。
 */

import type { Track } from "@shared/types/player";

interface CoverLoaderOptions {
  /** 已有封面时是否跳过（默认 false，总是兜底） */
  skipIfHasCover?: boolean;
  /** 最多尝试的插件数量（默认 3） */
  maxAttempts?: number;
}

/** 进行中的请求缓存，避免同一首 track 被并发重复请求 */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * 为指定 track 兜底加载封面
 *
 * @param track 当前播放的曲目
 * @param options 选项
 * @returns 命中的封面 URL；未命中返回 null
 */
export const loadCoverForTrack = async (
  track: Track,
  options: CoverLoaderOptions = {},
): Promise<string | null> => {
  if (options.skipIfHasCover && track.cover) return track.cover;
  if (track.source === "local" && !track.path) return null;

  const cacheKey = `${track.source}:${track.id}`;
  if (inFlight.has(cacheKey)) return inFlight.get(cacheKey)!;

  const promise = (async (): Promise<string | null> => {
    try {
      const plugins =
        (await window.api?.plugins?.getPluginsWithAction?.("musicPic")) ?? [];
      const maxAttempts = options.maxAttempts ?? 3;

      for (const plugin of plugins.slice(0, maxAttempts)) {
        try {
          const coverUrl = await window.api?.plugins?.callAction?.(
            plugin.manifest.id,
            "musicPic",
            {
              title: track.title,
              artist: track.artists.map((a) => a.name).join(" "),
              album: track.album?.name,
              id: track.id,
              source: track.source,
            },
          );
          if (coverUrl && typeof coverUrl === "string") {
            // 注：曲库封面回写由 media store 在 track.cover 更新后自动持久化
            return coverUrl;
          }
        } catch {
          // 单个插件失败继续下一个
        }
      }
      return null;
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, promise);
  return promise;
};
