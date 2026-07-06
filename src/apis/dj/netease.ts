import type { CoverItem } from "@/types/artist";
import type { Track } from "@shared/types/player";
import type { NeteaseSong } from "@/types/netease";
import { songToTrack } from "@/utils/format/netease";
import { withPicSize } from "@/utils/format/netease";
import { netease as neteaseApi } from "@/apis/netease";

/** 电台原始结构 */
interface RawDjRadio {
  id: number | string;
  name: string;
  dj?: { nickname?: string };
  picUrl?: string;
  desc?: string;
  category?: string;
  subCount?: number;
  programCount?: number;
}

/** 电台 → 封面卡片 */
const djToCover = (raw: RawDjRadio): CoverItem => ({
  id: String(raw.id),
  title: raw.name,
  cover: raw.picUrl ?? "",
  subtitle: raw.dj?.nickname || raw.desc || undefined,
  trackCount: raw.programCount ?? 0,
});

/** 电台推荐 */
export const fetchDjRecommend = async (limit = 30): Promise<CoverItem[]> => {
  const body = await neteaseApi.dj_recommend<{ djRadios?: RawDjRadio[] }>({ limit });
  return (body?.djRadios ?? []).map(djToCover);
};

/** 电台分类推荐 */
export const fetchDjCategoryRecommend = async (category: string): Promise<CoverItem[]> => {
  const body = await neteaseApi.dj_category_recommend<{ djRadios?: RawDjRadio[] }>({ category });
  return (body?.djRadios ?? []).map(djToCover);
};

/** 电台详情 */
export interface DjDetail {
  id: string;
  name: string;
  dj: string;
  cover: string;
  desc: string;
  category: string;
  subCount: number;
  programCount: number;
}

export const fetchDjDetail = async (rid: string): Promise<DjDetail | null> => {
  const body = await neteaseApi.dj_detail<{ djRadio?: RawDjRadio }>({ rid });
  const raw = body?.djRadio;
  if (!raw) return null;
  return {
    id: String(raw.id),
    name: raw.name,
    dj: raw.dj?.nickname ?? "",
    cover: raw.picUrl ?? "",
    desc: raw.desc ?? "",
    category: raw.category ?? "",
    subCount: raw.subCount ?? 0,
    programCount: raw.programCount ?? 0,
  };
};

/** 电台节目原始结构 */
interface RawDjProgram {
  id: number | string;
  name: string;
  coverUrl?: string;
  duration?: number;
  createTime?: number;
  listenerCount?: number;
  /** 节目内嵌的歌曲对象，mainSong.id 不在 song_url 覆盖范围，需走 dj/program/url */
  mainSong?: NeteaseSong;
  /** 节目所属电台副标题，部分接口返回 */
  radio?: { name?: string; dj?: { nickname?: string } };
  description?: string;
}

/** 电台节目应用层结构 */
export interface DjProgram {
  /** 节目 ID */
  id: string;
  /** 节目标题 */
  name: string;
  /** 节目封面 */
  cover: string;
  /** 时长（毫秒） */
  duration: number;
  /** 创建时间（Unix ms） */
  createTime: number;
  /** 收听数 */
  listenerCount: number;
  /** 简介 */
  desc: string;
  /** 转换后的可播放 Track（mainSong.id 作为 songId，走 song_url 解析） */
  track: Track;
}

/** 节目总条目数（用于分页判断） */
export interface DjProgramsResult {
  /** 节目列表 */
  list: DjProgram[];
  /** 电台节目总数 */
  total: number;
}

/** mainSong 字段不完整时补齐必要字段，避免 songToTrack 拿不到封面/时长 */
const programToTrack = (raw: RawDjProgram): Track => {
  const song: NeteaseSong = raw.mainSong ?? ({ id: Number(raw.id), name: raw.name } as NeteaseSong);
  // mainSong 在 dj/program 接口里往往缺 al/ar/dt，从节目级补齐
  if (!song.al && !song.album) {
    (song as NeteaseSong).al = {
      id: 0,
      name: raw.radio?.name ?? "",
      picUrl: raw.coverUrl ?? "",
    };
  }
  if ((!song.ar || song.ar.length === 0) && !song.artists) {
    (song as NeteaseSong).ar = [{ id: 0, name: raw.radio?.dj?.nickname ?? "" }];
  }
  if (!song.dt && !song.duration) {
    (song as NeteaseSong).dt = raw.duration ?? 0;
  }
  const track = songToTrack(song);
  // 节目封面优先于 song 自带的 al.picUrl（dj 接口 mainSong 常缺封面）
  if (raw.coverUrl) {
    track.cover = withPicSize(raw.coverUrl);
    track.coverOriginal = withPicSize(raw.coverUrl, 1024);
  }
  // extId 存节目 id：dj 节目的 mainSong.id 走常规 song_url 拿不到地址，
  // resolveNeteaseUrl 检测到 extId 时改走 dj/program/url
  track.extId = String(raw.id);
  return track;
};

const toDjProgram = (raw: RawDjProgram): DjProgram => ({
  id: String(raw.id),
  name: raw.name,
  cover: raw.coverUrl ?? "",
  duration: raw.duration ?? 0,
  createTime: raw.createTime ?? 0,
  listenerCount: raw.listenerCount ?? 0,
  desc: raw.description ?? "",
  track: programToTrack(raw),
});

/**
 * 拉取电台节目列表
 * @param rid - 电台 ID
 * @param offset - 偏移量，默认 0
 * @param limit - 每页数量，默认 30
 * @returns 节目列表 + 总数
 */
export const fetchDjPrograms = async (
  rid: string,
  offset = 0,
  limit = 30,
): Promise<DjProgramsResult> => {
  const body = await neteaseApi.dj_program<{
    programs?: RawDjProgram[];
    count?: number;
  }>({ rid, offset, limit });
  const list = (body?.programs ?? []).map(toDjProgram);
  return { list, total: body?.count ?? list.length };
};
