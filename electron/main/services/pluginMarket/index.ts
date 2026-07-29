/**
 * 插件市场服务
 */
import type { MarketEntry, MarketIndex, ReleaseChannel, UpdateCheckResult } from "@shared/types/pluginMarket";
import { isUpdateAvailable } from "./semver";

/** 构建市场索引 URL */
export const buildMarketIndexUrl = (baseUrl: string, channel: ReleaseChannel): string => {
  const normalized = baseUrl.replace(/\/$/, "");
  return `${normalized}/index.json?channel=${channel}`;
};

/** 校验并标准化市场条目，无效返回 null */
export const normalizeMarketEntry = (raw: unknown): MarketEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.version !== "string") {
    return null;
  }
  if (typeof r.downloadUrl !== "string") return null;

  return {
    id: r.id,
    name: r.name,
    version: r.version,
    description: typeof r.description === "string" ? r.description : undefined,
    author: typeof r.author === "string" ? r.author : undefined,
    downloadUrl: r.downloadUrl,
    sha256: typeof r.sha256 === "string" ? r.sha256 : undefined,
    homepage: typeof r.homepage === "string" ? r.homepage : undefined,
    minAppVersion: typeof r.minAppVersion === "string" ? r.minAppVersion : undefined,
    maxAppVersion: typeof r.maxAppVersion === "string" ? r.maxAppVersion : undefined,
    permissions: Array.isArray(r.permissions) ? (r.permissions as string[]) : undefined,
    tags: Array.isArray(r.tags) ? (r.tags as string[]) : undefined,
    downloadCount: typeof r.downloadCount === "number" ? r.downloadCount : undefined,
    rating: typeof r.rating === "number" ? r.rating : undefined,
    publishedAt: typeof r.publishedAt === "number" ? r.publishedAt : undefined,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : undefined,
  };
};

/** 解析市场索引响应 */
export const parseMarketIndex = (raw: unknown): MarketIndex | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.entries)) return null;

  const entries: MarketEntry[] = [];
  for (const item of r.entries) {
    const entry = normalizeMarketEntry(item);
    if (entry) entries.push(entry);
  }

  return {
    version: typeof r.version === "number" ? r.version : 1,
    channel: (typeof r.channel === "string" ? r.channel : "stable") as ReleaseChannel,
    entries,
    generatedAt: typeof r.generatedAt === "number" ? r.generatedAt : Date.now(),
  };
};

/** 拉取市场索引 */
export const fetchMarketIndex = async (
  baseUrl: string,
  channel: ReleaseChannel = "stable",
): Promise<MarketIndex> => {
  const url = buildMarketIndexUrl(baseUrl, channel);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch market index: ${res.status}`);
  }
  const json = await res.json();
  const index = parseMarketIndex(json);
  if (!index) {
    throw new Error("Invalid market index format");
  }
  return index;
};

/** 检查插件更新 */
export const checkForUpdate = (
  pluginId: string,
  currentVersion: string,
  index: MarketIndex,
): UpdateCheckResult => {
  const entry = index.entries.find((e) => e.id === pluginId);
  if (!entry) {
    return { hasUpdate: false, currentVersion, latestVersion: currentVersion };
  }
  return {
    hasUpdate: isUpdateAvailable(currentVersion, entry.version),
    currentVersion,
    latestVersion: entry.version,
    entry,
  };
};

/** 下载插件包到指定路径 */
export const downloadPlugin = async (entry: MarketEntry, destPath: string): Promise<void> => {
  const { default: fs } = await import("node:fs");
  const res = await fetch(entry.downloadUrl);
  if (!res.ok) {
    throw new Error(`Failed to download plugin: ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());

  // SHA256 校验
  if (entry.sha256) {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (hash !== entry.sha256) {
      throw new Error(`SHA256 mismatch: expected ${entry.sha256}, got ${hash}`);
    }
  }

  await fs.promises.writeFile(destPath, buffer);
};
