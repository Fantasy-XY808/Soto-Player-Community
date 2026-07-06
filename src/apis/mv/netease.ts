import { netease as neteaseApi } from "@/apis/netease";

/** MV 列表项 */
export interface MvItem {
  id: string;
  name: string;
  artistName: string;
  cover: string;
  duration: number;
  playCount?: number;
}

/** MV 详情 */
export interface MvDetail {
  id: string;
  name: string;
  artistName: string;
  cover: string;
  desc?: string;
  duration: number;
  playCount?: number;
  /** 各分辨率 URL 映射 */
  brs: Record<number, string>;
}

/** MV URL 响应 */
export interface MvUrl {
  id: string;
  url: string;
  size: number;
  /** 实际返回的分辨率 */
  r: number;
}

interface RawMv {
  id: number | string;
  name: string;
  artistName?: string;
  artists?: { name: string }[];
  cover?: string;
  duration?: number;
  playCount?: number;
}

const toMvItem = (raw: RawMv): MvItem => ({
  id: String(raw.id),
  name: raw.name,
  artistName: raw.artistName ?? raw.artists?.map((a) => a.name).join("/") ?? "",
  cover: raw.cover ?? "",
  duration: raw.duration ?? 0,
  playCount: raw.playCount,
});

/** MV 首页（最新 MV，支持分页）
 * @param area - 地区，空字符串为全部
 * @param limit - 单页数量
 * @param offset - 偏移量，默认 0
 */
export const fetchMvFirst = async (area = "", limit = 30, offset = 0): Promise<MvItem[]> => {
  const body = await neteaseApi.mv_first<{ data?: RawMv[] }>({ area, limit, offset });
  return (body?.data ?? []).map(toMvItem);
};

/** MV 详情 */
export const fetchMvDetail = async (mvId: string): Promise<MvDetail | null> => {
  const body = await neteaseApi.mv_detail<{
    data?: RawMv & { desc?: string; brs?: Record<string, string> };
  }>({
    mvid: mvId,
  });
  const raw = body?.data;
  if (!raw) return null;
  const brs: Record<number, string> = {};
  if (raw.brs) {
    for (const [k, v] of Object.entries(raw.brs)) {
      brs[Number(k)] = String(v);
    }
  }
  return {
    id: String(raw.id),
    name: raw.name,
    artistName: raw.artistName ?? raw.artists?.map((a) => a.name).join("/") ?? "",
    cover: raw.cover ?? "",
    desc: raw.desc,
    duration: raw.duration ?? 0,
    playCount: raw.playCount,
    brs,
  };
};

/** MV 播放地址（按分辨率） */
export const fetchMvUrl = async (mvId: string, r = 1080): Promise<MvUrl | null> => {
  const body = await neteaseApi.mv_url<{
    data?: { id?: number; url?: string; size?: number; r?: number };
  }>({
    id: mvId,
    r,
  });
  const raw = body?.data;
  if (!raw?.url) return null;
  return {
    id: String(raw.id ?? mvId),
    url: raw.url,
    size: raw.size ?? 0,
    r: raw.r ?? r,
  };
};
