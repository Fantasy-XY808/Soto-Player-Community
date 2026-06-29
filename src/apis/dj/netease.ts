import type { CoverItem } from "@/types/artist";
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
