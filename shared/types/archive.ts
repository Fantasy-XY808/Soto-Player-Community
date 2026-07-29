/**
 * Internet Archive 共享类型
 *
 * archive.org 公开 API，完全无鉴权（不需要 token / cookie / signature），
 * 因此不像 Qobuz 那样需要 setToken / getToken / setAppSecrets 等接口。
 *
 * 渲染端通过统一 `window.api.apis.call("archive", name, params)` 访问，
 * 不暴露独立的 window.api.archive 命名空间。
 */

/**
 * 音质档位（与 src/utils/quality.ts 的 QualityLevel 对齐）
 *
 * 在 shared 层内联以避免 shared → src 反向依赖。
 * 8 档：lq < sq < hq < lossless < hi-res < jyeffect < sky < jymaster
 */
export type ArchiveQuality =
  | "lq"
  | "sq"
  | "hq"
  | "lossless"
  | "hi-res"
  | "jyeffect"
  | "sky"
  | "jymaster";

/**
 * Archive 渲染端 API 接口签名（仅类型声明，不暴露到 window.api）
 *
 * 通过 src/apis/archive.ts 中的 Proxy 调用：
 * - archive.search({ keywords, page, limit })
 * - archive.song_url({ trackId, quality })
 * - archive.lyric({ trackId })
 */
export interface ArchiveApi {
  /** 搜索 etree 集合现场录音 */
  search: (params: {
    keywords: string;
    page?: number;
    limit?: number;
  }) => Promise<{
    code: number;
    total: number;
    songs: Array<{
      id: string;
      title: string;
      artist: string;
      album: string;
      albumId: string;
      cover?: string;
      duration: number;
      qualities: string[];
    }>;
    message?: string;
  }>;

  /**
   * 解析播放 URL（trackId 即 archive.org identifier）
   *
   * @param params.trackId - archive.org identifier
   * @param params.quality - 用户音质档位；高音质（lossless/hi-res/jymaster）优先返回 flac，
   *   常规档位（hq/sq/lq）优先返回 mp3。不传时按默认 mp3 → flac → ogg 顺序
   */
  song_url: (params: {
    trackId: string;
    quality?: ArchiveQuality;
  }) => Promise<{
    code: number;
    url: string;
    source?: "archive";
    message?: string;
  }>;

  /** 占位：archive.org 不提供歌词 */
  lyric: (params: { trackId: string }) => Promise<{
    code: number;
    message?: string;
  }>;
}
