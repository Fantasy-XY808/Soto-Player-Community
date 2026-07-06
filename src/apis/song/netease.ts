import type { Track } from "@shared/types/player";
import type { QualityLevel } from "@/utils/quality";
import { clampQualityLevel } from "@/utils/quality";
import { useUserStore } from "@/stores/user";
import { netease as neteaseApi } from "@/apis/netease";
import { songsToTracks } from "@/utils/format/netease";

/** 拼接艺术家名称（用于解灰源关键词） */
const formatArtists = (artists: Track["artists"]): string => {
  if (!artists?.length) return "";
  return artists.map((ar) => ar.name).join(" / ");
};

/**
 * 调用解灰源 IPC，按配置顺序尝试获取可播放 URL
 * @param track - 原曲元数据
 * @returns 解灰得到的 URL 或 null
 */
const resolveUnblockUrl = async (track: Track): Promise<string | null> => {
  const artist = formatArtists(track.artists);
  const keyword = artist ? `${track.title} - ${artist}` : track.title;
  const res = await window.api.unblock.resolve({
    keyword,
    songName: track.title,
    artist,
  });
  if (!res?.success) return null;
  return res.data.url;
};

/**
 * 按 ID 批量取歌曲详情
 * @param ids - 网易云 songId 列表
 * @returns 与传入 ids 对应的 Track 列表
 */
export const songsByIds = async (ids: Array<string | number>): Promise<Track[]> => {
  const cleaned = ids.map((v) => String(v).trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const body = await neteaseApi.song_detail({ ids: cleaned.join(",") });
  return songsToTracks(body?.songs);
};

/** 项目音质档位 → 网易云 song/url v1 的 level 参数
 * jyeffect/sky/jymaster 为网易云 VIP 专属环绕/母带档位 */
const NETEASE_LEVEL: Record<QualityLevel, string> = {
  lq: "standard",
  sq: "higher",
  hq: "exhigh",
  lossless: "lossless",
  "hi-res": "hires",
  jyeffect: "jyeffect",
  sky: "sky",
  jymaster: "jymaster",
};

/**
 * 按当前用户登录态把音质档位限制到可用范围内
 * - 未登录：强制 standard（128k）
 * - 已登录非 VIP：lq/sq/hq
 * - VIP/SVIP：全部 8 档
 * @param songLevel - 用户偏好的音质档位
 * @returns 实际可用的档位
 */
const resolveAllowedLevel = (songLevel: QualityLevel): QualityLevel => {
  const user = useUserStore();
  const isLoggedIn = user.isLoggedIn;
  const isVip = (user.profile?.vipType ?? 0) !== 0;
  return clampQualityLevel(songLevel, isLoggedIn, isVip);
};

/**
 * 解析网易云 Track 的可播放 URL
 * VIP 试听片段 / 无版权 → 走解灰源 fallback；仍失败返回 null
 * 电台节目（track.extId 存节目 id）走 dj/program/url，常规歌曲走 song/url v1
 * @param track - track.id 为云端 songId；track.extId 为电台节目 id 时走节目接口
 * @param songLevel - 音质偏好；实际可用级别取决于账号权限
 */
export const resolveNeteaseUrl = async (
  track: Track,
  songLevel: QualityLevel,
): Promise<string | null> => {
  // 电台节目：mainSong.id 不在 song_url 覆盖范围，必须走 dj/program/url
  if (track.extId) {
    const br = levelToBr(resolveAllowedLevel(songLevel));
    const body = await neteaseApi.dj_program_url<{ data?: { url?: string } }>({
      id: track.extId,
      br,
    });
    const url = body?.data?.url;
    return url || null;
  }
  const level = NETEASE_LEVEL[resolveAllowedLevel(songLevel)];
  const body = await neteaseApi.song_url({ id: track.id, level });
  const item = body?.data?.[0];
  // 试听片段 / 无版权 → 尝试解灰源
  if (!item?.url || item.freeTrialInfo) {
    return resolveUnblockUrl(track);
  }
  return item.url;
};

/** 音质档位 → dj/program/url 的 br 码率参数 */
const levelToBr = (level: QualityLevel): number => {
  const map: Record<QualityLevel, number> = {
    lq: 128_000,
    sq: 192_000,
    hq: 320_000,
    lossless: 999_000,
    "hi-res": 999_000,
    jyeffect: 999_000,
    sky: 999_000,
    jymaster: 999_000,
  };
  return map[level] ?? 320_000;
};

/** 网易云下载源（带格式与体积） */
export interface NeteaseDownloadSource {
  url: string;
  /** 文件格式（flac/mp3 等） */
  format?: string;
  /** 体积（字节） */
  size?: number;
}

/** 官方下载接口（客户端下载，占用每日下载次数）；data 为单对象 */
const fetchNeteaseDownloadSource = async (
  id: string,
  level: string,
): Promise<NeteaseDownloadSource | null> => {
  try {
    const body = await neteaseApi.song_download_url({ id, level });
    const item = body?.data;
    if (!item?.url) return null;
    return { url: item.url, format: item.type, size: item.size };
  } catch {
    return null;
  }
};

/** 播放接口（不占用下载次数）；data 为数组、可能是试听片段 */
const fetchNeteasePlaySource = async (
  id: string,
  level: string,
): Promise<NeteaseDownloadSource | null> => {
  try {
    const body = await neteaseApi.song_url({ id, level });
    const item = body?.data?.[0];
    if (!item?.url || item.freeTrialInfo) return null;
    return { url: item.url, format: item.type, size: item.size };
  } catch {
    return null;
  }
};

/**
 * 解析网易云 Track 的下载源
 * 默认走官方下载接口（客户端下载），无果时回落播放接口；
 * 「模拟播放下载」开启时只用播放接口，避免占用每日下载次数。
 * @param track - track.id 为 songId
 * @param songLevel - 下载音质
 * @param usePlayback - 模拟播放下载：跳过下载接口、直接用播放接口
 * @returns 下载源（带格式与体积）；试听 / 无版权返回 null
 */
export const resolveNeteaseDownloadUrl = async (
  track: Track,
  songLevel: QualityLevel,
  usePlayback = false,
): Promise<NeteaseDownloadSource | null> => {
  const level = NETEASE_LEVEL[resolveAllowedLevel(songLevel)];
  if (!usePlayback) {
    const downloaded = await fetchNeteaseDownloadSource(track.id, level);
    if (downloaded) return downloaded;
  }
  return fetchNeteasePlaySource(track.id, level);
};
