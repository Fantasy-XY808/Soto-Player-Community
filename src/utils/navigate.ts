import type { TrackSource } from "@shared/types/player";
import router from "@/router";

/** 非本地源 */
const isExternal = (source: TrackSource): boolean => source !== "local";

/**
 * 跳转到专辑页
 * 非本地源没拿到真实 albumId 时静默忽略，避免用专辑名当 ID 触发服务器 400 / 路由错位
 * @param albumName - 专辑名称
 * @param options.source - 来源
 * @param options.albumId - 真实专辑 ID
 */
export const navigateToAlbum = (
  albumName?: string,
  options: { source?: TrackSource; albumId?: string } = {},
) => {
  const source = options.source ?? "local";
  const id = isExternal(source) ? options.albumId : albumName;
  if (!id?.trim()) return;
  const query =
    isExternal(source) && albumName && albumName !== id ? { name: albumName } : undefined;
  router.push({
    name: "collection",
    params: { source, type: "album", id: encodeURIComponent(id) },
    query,
  });
};

/**
 * 跳转到歌手页
 * 非本地源没拿到真实 artistId 时静默忽略
 * @param artistName - 歌手名称（本地用作聚合 key；非本地用于 query 兜底显示）
 * @param options.source - 来源；默认为 local
 * @param options.artistId - 真实歌手 ID（非本地必填）
 */
export const navigateToArtist = (
  artistName?: string,
  options: { source?: TrackSource; artistId?: string } = {},
) => {
  const source = options.source ?? "local";
  const id = isExternal(source) ? options.artistId : artistName;
  if (!id?.trim()) return;
  const query =
    isExternal(source) && artistName && artistName !== id ? { name: artistName } : undefined;
  router.push({
    name: "artist",
    params: { source, id: encodeURIComponent(id) },
    query,
  });
};

/**
 * 跳转到歌单页
 * 任意来源都依赖 playlistId
 * @param playlistId - 歌单 ID
 * @param options.source - 来源
 * @param options.name - 标题兜底
 */
export const navigateToPlaylist = (
  playlistId: string | undefined,
  options: { source?: TrackSource; name?: string } = {},
) => {
  if (!playlistId?.trim()) return;
  const source = options.source ?? "local";
  router.push({
    name: "collection",
    params: { source, type: "playlist", id: encodeURIComponent(playlistId) },
    query: options.name ? { name: options.name } : undefined,
  });
};

/**
 * 跳转到 MV 详情/播放页
 * @param mvId - MV ID
 * @param options.name - 标题兜底（用于页面顶部展示，避免详情未拉到时空标题）
 */
export const navigateToMv = (mvId: string | undefined, options: { name?: string } = {}) => {
  if (!mvId?.trim()) return;
  router.push({
    name: "mv-detail",
    params: { id: encodeURIComponent(mvId) },
    query: options.name ? { name: options.name } : undefined,
  });
};

/**
 * 跳转到视频详情/播放页
 * @param videoId - 视频 ID
 * @param options.name - 标题兜底（用于页面顶部展示，避免详情未拉到时空标题）
 */
export const navigateToVideo = (videoId: string | undefined, options: { name?: string } = {}) => {
  if (!videoId?.trim()) return;
  router.push({
    name: "Video",
    params: { id: encodeURIComponent(videoId) },
    query: options.name ? { name: options.name } : undefined,
  });
};

/**
 * 跳转到动态详情页
 * @param eventId - 动态 ID
 */
export const navigateToEvent = (eventId: string | undefined) => {
  if (!eventId?.trim()) return;
  router.push({
    name: "event-detail",
    params: { id: encodeURIComponent(eventId) },
  });
};

/**
 * 跳转到电台详情页
 * @param rid - 电台 ID
 * @param options.name - 标题兜底（用于页面顶部展示，避免详情未拉到时空标题）
 */
export const navigateToRadio = (rid: string | undefined, options: { name?: string } = {}) => {
  if (!rid?.trim()) return;
  router.push({
    name: "radio-detail",
    params: { id: encodeURIComponent(rid) },
    query: options.name ? { name: options.name } : undefined,
  });
};
