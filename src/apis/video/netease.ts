/**
 * 网易云视频 API
 *
 * 与 MV 接口区分：视频是用户上传内容（/api/cloudvideo/*），MV 是官方音乐视频（/api/mv/*）
 */

import type {
  Video,
  VideoCategory,
  VideoGroup,
  VideoResolution,
  VideoUrlResult,
} from "@shared/types/video";
import { netease as neteaseApi } from "@/apis/netease";

/** 服务端原始视频详情结构 */
interface RawVideoDetail {
  id: number | string;
  name?: string;
  cover?: string;
  coverUrl?: string;
  duration?: number;
  durationms?: number;
  playTime?: number;
  playCount?: number;
  description?: string;
  desc?: string;
  artists?: { id: number; name: string }[];
  creator?: { userId: number; nickname: string };
  tags?: { id: number; name: string }[];
  videoGroup?: { id: number }[];
  relatedVideoList?: { vid: number | string }[];
}

/** 服务端原始视频 URL 结构 */
interface RawVideoUrl {
  id: number | string;
  url: string;
  size?: number;
  resolution?: number;
  r?: number;
}

/** 把服务端原始详情归一化为 Video */
const toVideo = (raw: RawVideoDetail): Video => ({
  id: Number(raw.id),
  name: raw.name ?? "",
  cover: raw.cover ?? raw.coverUrl ?? "",
  duration: raw.durationms ?? raw.duration ?? 0,
  playTime: raw.playTime ?? raw.playCount ?? 0,
  description: raw.description ?? raw.desc ?? "",
  artists: Array.isArray(raw.artists)
    ? raw.artists.map((a) => ({ id: a.id, name: a.name }))
    : raw.creator
      ? [{ id: raw.creator.userId, name: raw.creator.nickname }]
      : [],
  tags: Array.isArray(raw.tags) ? raw.tags.map((t) => ({ id: t.id, name: t.name })) : [],
  relatedVideoIds: Array.isArray(raw.relatedVideoList)
    ? raw.relatedVideoList.map((r) => Number(r.vid))
    : undefined,
});

/**
 * 获取视频详情
 * @param id - 视频 id
 * @returns 视频详情；未找到返回 null
 */
export const fetchVideoDetail = async (id: string | number): Promise<Video | null> => {
  const body = await neteaseApi.video_detail<{ data?: RawVideoDetail }>({ id: String(id) });
  const raw = body?.data;
  if (!raw) return null;
  return toVideo(raw);
};

/**
 * 获取视频播放地址
 * @param id - 视频 id
 * @param resolution - 分辨率，默认 1080
 * @returns 播放 URL 信息；无可用地址（VIP / 版权限制）返回 null
 */
export const fetchVideoUrl = async (
  id: string | number,
  resolution: VideoResolution = 1080,
): Promise<VideoUrlResult | null> => {
  const body = await neteaseApi.video_url<{ urls?: RawVideoUrl[] }>({
    id: String(id),
    resolution,
  });
  const raw = body?.urls?.[0];
  if (!raw?.url) return null;
  return {
    id: Number(raw.id),
    url: raw.url,
    resolution: (raw.resolution ?? raw.r ?? resolution) as VideoResolution,
    size: raw.size ?? 0,
  };
};

/** 获取视频分类列表 */
export const fetchVideoCategoryList = async (): Promise<VideoCategory[]> => {
  const body = await neteaseApi.video_category_list<{ data?: { id: number; name: string }[] }>();
  return (body?.data ?? []).map((c) => ({ id: c.id, name: c.name }));
};

/** 获取视频分组列表 */
export const fetchVideoGroupList = async (): Promise<VideoGroup[]> => {
  const body = await neteaseApi.video_group_list<{
    data?: { id: number; name: string; type?: number }[];
  }>();
  return (body?.data ?? []).map((g) => ({ id: g.id, name: g.name, type: g.type }));
};
