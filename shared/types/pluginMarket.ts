/**
 * 插件市场共享类型
 */

export type ReleaseChannel = "stable" | "beta" | "dev";

export interface MarketEntry {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  downloadUrl: string;
  sha256?: string;
  homepage?: string;
  minAppVersion?: string;
  maxAppVersion?: string;
  permissions?: string[];
  tags?: string[];
  downloadCount?: number;
  rating?: number;
  publishedAt?: number;
  updatedAt?: number;
}

export interface MarketIndex {
  version: number;
  channel: ReleaseChannel;
  entries: MarketEntry[];
  generatedAt: number;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  entry?: MarketEntry;
}
