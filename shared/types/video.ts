/**
 * 网易云视频类型定义
 * 与 MV 区分：视频是用户上传内容，MV 是官方音乐视频
 */

/** 视频画质 */
export type VideoResolution = 1080 | 720 | 480 | 240;

/** 视频歌手/创作者 */
export interface VideoArtist {
  id: number;
  name: string;
}

/** 视频标签 */
export interface VideoTag {
  id: number;
  name: string;
}

/** 网易云视频 */
export interface Video {
  id: number;
  name: string;
  cover: string;
  /** 时长（毫秒） */
  duration: number;
  /** 播放次数 */
  playTime: number;
  /** 简介 */
  description: string;
  artists: VideoArtist[];
  tags: VideoTag[];
  /** 相关视频 id 列表 */
  relatedVideoIds?: number[];
}

/** 视频播放 URL 响应 */
export interface VideoUrlResult {
  id: number;
  url: string;
  resolution: VideoResolution;
  /** 文件大小（字节） */
  size: number;
}

/** 视频分类 */
export interface VideoCategory {
  id: number;
  name: string;
}

/** 视频分组 */
export interface VideoGroup {
  id: number;
  name: string;
  /** 分组类型 */
  type?: number;
}
