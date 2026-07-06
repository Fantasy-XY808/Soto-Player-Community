/**
 * SPlayer-Next → Soto Player-Community 数据迁移
 *
 * 项目改名后 app.getName() 改变，userData 路径随之变化：
 *   旧：C:\Users\<u>\AppData\Roaming\SPlayer-Next\app-data\
 *   新：C:\Users\<u>\AppData\Roaming\soto-player-community\app-data\
 *
 * 迁移范围：config / database / cache / plugins（logs 不迁移，旧日志无价值）
 * 流媒体凭证（streaming.json）与 Last.fm 凭证（lastfm.json）用 Electron safeStorage
 * 加密，密钥与 OS 用户绑定，迁移后仍可解密
 */

import { app } from "electron";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { systemLog } from "@main/utils/logger";
import { dataRoot } from "@main/utils/paths";

/** 需要迁移的子目录（与 paths.ts 中定义对齐） */
const MIGRATE_SUBDIRS = ["config", "database", "cache", "plugins"] as const;

/**
 * 可能的旧 userData 目录名
 *
 * 项目曾多次改名：SPlayer-Next / SPlayer / soto-player-community / soto-player 等，
 * 兼容常见历史名称，按发现顺序返回第一个包含 settings.json 的旧数据根目录
 */
const LEGACY_DIR_CANDIDATES = [
  "SPlayer-Next",
  "soto-player-community",
  "soto-player",
  "SPlayer",
  "soto-music",
] as const;

/**
 * 计算旧数据根目录，自动探测多种历史目录名
 * @returns 探测到的旧 app-data 路径；不存在时回退到 SPlayer-Next
 */
const getLegacyDataRoot = (): string => {
  const currentUserData = app.getPath("userData");
  const parent = path.dirname(currentUserData);
  for (const dir of LEGACY_DIR_CANDIDATES) {
    const root = path.join(parent, dir, "app-data");
    const settingsPath = path.join(root, "config", "settings.json");
    if (existsSync(settingsPath)) return root;
  }
  return path.join(parent, "SPlayer-Next", "app-data");
};

/** 旧数据是否存在（用于引导/设置中决定是否显示迁移选项） */
export const hasLegacyData = (): boolean => {
  const legacyRoot = getLegacyDataRoot();
  // config/settings.json 是核心配置，存在它即视为旧数据有效
  const legacySettings = path.join(legacyRoot, "config", "settings.json");
  return existsSync(legacySettings);
};

/** 递归复制目录（覆盖目标） */
const copyDir = async (src: string, dest: string): Promise<void> => {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
};

/**
 * 执行迁移：把旧数据各子目录复制到新位置（覆盖）
 *
 * 注意：迁移后当前已设置的选项会被覆盖，由 UI 在调用前提示用户确认
 * @returns 迁移结果摘要
 */
export const performMigration = async (): Promise<{
  ok: boolean;
  migrated: string[];
  error?: string;
}> => {
  const legacyRoot = getLegacyDataRoot();
  const migrated: string[] = [];
  try {
    for (const sub of MIGRATE_SUBDIRS) {
      const src = path.join(legacyRoot, sub);
      const dest = path.join(dataRoot, sub);
      try {
        await fs.access(src);
      } catch {
        // 旧数据中无此子目录，跳过
        continue;
      }
      await copyDir(src, dest);
      migrated.push(sub);
    }
    systemLog.info(`[migration] 迁移完成: ${migrated.join(", ")}`);
    return { ok: true, migrated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    systemLog.error("[migration] 迁移失败:", err);
    return { ok: false, migrated, error: msg };
  }
};
