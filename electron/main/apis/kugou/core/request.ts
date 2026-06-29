/**
 * KG 请求层
 *
 * 设计：
 * - 主搜索走 mobilecdn.kugou.com/api/v3/search/song（公网无鉴权，含封面）
 * - 兜底搜索走 songsearch.kugou.com（无鉴权，无封面）
 * - 歌词走 lyrics.kugou.com（需要 KG-RC/KG-THash/UA 伪装 PC 客户端）
 * - 成功码约定不统一：songsearch/mobilecdn 用 error_code=0，lyrics 用 error_code=200
 */

interface FetchOptions {
  headers?: Record<string, string>;
}

interface KGRawBody {
  status?: number;
  error_code?: number;
  errcode?: number;
  err_code?: number;
  data?: unknown;
  info?: unknown;
  [key: string]: unknown;
}

/** 发一次 KG GET 请求，返回解析后的 JSON body；失败直接抛错由上层 fallback 处理 */
export const kgRequest = async <T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const res = await fetch(url, {
    method: "GET",
    headers: options.headers,
    signal: AbortSignal.timeout(8000),
  });
  if (res.status !== 200) throw new Error(`KG HTTP ${res.status}`);

  const body = (await res.json()) as KGRawBody;
  // 0 = mobilecdn/songsearch 风格成功码，200 = lyrics.kugou.com 的 HTTP 风格成功码
  const code = body.error_code ?? body.errcode ?? body.err_code ?? 0;
  if (code !== 0 && code !== 200) throw new Error(`KG API error_code=${code}`);

  return body as T;
};
