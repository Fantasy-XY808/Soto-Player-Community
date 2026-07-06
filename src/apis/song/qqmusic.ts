import type { Track } from "@shared/types/player";
import { qqmusic as qqmusicApi } from "@/apis/qqmusic";
import { useQqUserStore } from "@/stores/qqUser";

interface SongUrlResp {
  code: number;
  url: string;
  message?: string;
}

export interface ResolveQQMusicUrlOptions {
  /**
   * 是否带 cookie 调用 VIP 接口
   * - true：主进程优先用 cookie 拿 320k / flac，失败回落匿名候选
   * - false：仅匿名
   * - undefined（默认）：自动按 QQ 账户登录态决定
   */
  withCredentials?: boolean;
}

/**
 * 解析 QQ 音乐 Track 的可播放 URL
 *
 * - 未登录或 withCredentials=false：匿名态拿 128k mp3
 * - 登录态（withCredentials=true 或自动检测）：主进程优先拿 VIP 高品质，失败回落匿名
 * - VIP / 版权 → 返回 null，由调用方回落插件
 *
 * @param track - track.id 为 songmid
 * @param options - withCredentials 控制是否带 cookie
 */
export const resolveQQMusicUrl = async (
  track: Track,
  options?: ResolveQQMusicUrlOptions,
): Promise<string | null> => {
  const withCredentials = options?.withCredentials ?? useQqUserStore().isLoggedIn;
  try {
    const body = await qqmusicApi.song_url<SongUrlResp>({ mid: track.id, withCredentials });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
