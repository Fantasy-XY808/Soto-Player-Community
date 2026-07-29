/**
 * 封面加载与缓存服务
 */
import { createHash } from "node:crypto";
import { join, extname } from "node:path";

export interface CoverCacheEntry {
  key: string;
  path: string;
  source: string;
  sourceId: string;
  createdAt: number;
  size: number;
}

/** 构建封面缓存 key */
export const buildCoverCacheKey = (source: string, sourceId: string): string => {
  if (!source && !sourceId) {
    return `cover:fallback:${createHash("md5").update(String(Date.now())).digest("hex").slice(0, 8)}`;
  }
  return `cover:${source}:${sourceId}`;
};

/** 解析封面路径：本地文件直接返回，远程 URL 映射到缓存路径 */
export const resolveCoverPath = (coverUrl: string, cacheDir: string): string => {
  if (!coverUrl) return "";
  if (/^https?:\/\//.test(coverUrl)) {
    const hash = createHash("md5").update(coverUrl).digest("hex").slice(0, 16);
    const ext = extname(new URL(coverUrl).pathname) || ".jpg";
    return join(cacheDir, `cover_${hash}${ext}`);
  }
  return coverUrl;
};

/** 判断缓存中是否存在该封面 */
export const isCoverCached = (
  cache: Map<string, CoverCacheEntry>,
  key: string,
): boolean => cache.has(key);

/**
 * 下载远程封面到本地缓存
 * 返回本地路径。已缓存则直接返回。
 */
export const loadCover = async (
  coverUrl: string,
  source: string,
  sourceId: string,
  cacheDir: string,
  cache: Map<string, CoverCacheEntry>,
): Promise<string> => {
  if (!coverUrl) return "";
  if (!/^https?:\/\//.test(coverUrl)) return coverUrl;

  const key = buildCoverCacheKey(source, sourceId);
  const cached = cache.get(key);
  if (cached) return cached.path;

  const localPath = resolveCoverPath(coverUrl, cacheDir);
  const fs = await import("node:fs");
  const res = await fetch(coverUrl);
  if (!res.ok) throw new Error(`Failed to fetch cover: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.promises.mkdir(cacheDir, { recursive: true });
  await fs.promises.writeFile(localPath, buffer);

  cache.set(key, {
    key,
    path: localPath,
    source,
    sourceId,
    createdAt: Date.now(),
    size: buffer.length,
  });

  return localPath;
};
