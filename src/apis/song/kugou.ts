import type { Track } from "@shared/types/player";
import { kugou as kugouApi } from "@/apis/kugou";
import { useKugouUserStore } from "@/stores/kugouUser";

interface SongUrlResp {
  code: number;
  url: string;
  message?: string;
}

export interface ResolveKugouUrlOptions {
  /**
   * 是否带 cookie 调用 VIP 接口
   * - true：主进程优先用 cookie 拿高品质 URL，失败回落匿名
   * - false：仅匿名
   * - undefined（默认）：自动按酷狗账户登录态决定
   */
  withCredentials?: boolean;
}

/**
 * 解析酷狗 Track 的可播放 URL
 *
 * - 未登录或 withCredentials=false：匿名态拿 128k mp3
 * - 登录态（withCredentials=true 或自动检测）：主进程优先拿 VIP 高品质，失败回落匿名
 * - VIP / 版权 → 返回 null，由调用方回落插件
 *
 * @param track - track.id 为 hash，track.album.id 为 album_id
 * @param options - withCredentials 控制是否带 cookie
 */
export const resolveKugouUrl = async (
  track: Track,
  options?: ResolveKugouUrlOptions,
): Promise<string | null> => {
  const withCredentials = options?.withCredentials ?? useKugouUserStore().isLoggedIn;
  try {
    const body = await kugouApi.song_url<SongUrlResp>({
      hash: track.id,
      albumId: track.album?.id,
      withCredentials,
    });
    if (body?.code !== 200) return null;
    return body.url || null;
  } catch {
    return null;
  }
};
