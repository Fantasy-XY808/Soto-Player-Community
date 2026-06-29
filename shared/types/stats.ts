/**
 * 播放统计采集类型
 *
 * 渲染端构造、主进程写入 SQLite。直接带完整 Track,行即自包含、可还原重播。
 */

import type { Track } from "./player";

/** 一次播放的统计事件,写入 play_history */
export interface PlayEventInput {
  /** 完整曲目（播放当时的快照） */
  track: Track;
  /** 本次播放开始 unix ms */
  startedAt: number;
  /** 实际收听墙钟毫秒（扣掉暂停） */
  listenedMs: number;
}

/** 一次收藏变更事件,写入 favorite_history */
export interface FavoriteEventInput {
  /** 完整曲目（操作当时的快照） */
  track: Track;
  /** 收藏 / 取消收藏 */
  action: "add" | "remove";
}

/** 播放统计汇总 */
export interface PlayStatsSummary {
  /** 今日收听时长（毫秒） */
  todayListenedMs: number;
  /** 本周收听时长（毫秒） */
  weekListenedMs: number;
  /** 上周收听时长（毫秒，用于环比） */
  lastWeekListenedMs: number;
  /** 累计收听时长（毫秒） */
  totalListenedMs: number;
  /** 本周播放次数 */
  weekPlayCount: number;
  /** 累计播放次数 */
  totalPlayCount: number;
  /** 本周新增收藏数 */
  weekFavoriteAdds: number;
  /** 连续收听天数 */
  streakDays: number;
}

/** 一首高频曲目及其播放次数 */
export interface TopTrack {
  /** 曲目（播放当时的快照） */
  track: Track;
  /** 累计播放次数 */
  playCount: number;
}

/** 一位高频艺人及其播放次数 / 累计时长 */
export interface TopArtist {
  /** 艺人名（取主艺人，无则"未知艺人"） */
  name: string;
  /** 累计播放次数 */
  playCount: number;
  /** 累计收听毫秒 */
  listenedMs: number;
}

/** 单个小时段（0-23）的播放次数 */
export interface HourlyStat {
  /** 0-23 */
  hour: number;
  /** 该小时内的播放次数 */
  playCount: number;
}

/** preload 暴露的统计 API */
export interface StatsApi {
  /** 记录一次播放 */
  recordPlay: (event: PlayEventInput) => void;
  /** 记录一次收藏变更 */
  recordFavorite: (event: FavoriteEventInput) => void;
  /** 取播放统计汇总 */
  getStatsSummary: () => Promise<PlayStatsSummary>;
  /** 取最常播放的曲目（按次数倒序） */
  getTopTracks: (limit: number) => Promise<TopTrack[]>;
  /** 取最常播放的艺人（按次数倒序） */
  getTopArtists: (limit: number) => Promise<TopArtist[]>;
  /** 取 24 小时播放分布 */
  getHourlyDistribution: () => Promise<HourlyStat[]>;
}
