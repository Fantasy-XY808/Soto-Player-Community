/**
 * JSON 凭证文件的内存缓存读取器
 *
 * 适用于高频被读取的小凭证文件（cookie/token/sessionKey 等）。
 * 通过模块级 Map 缓存解析后的对象，避免每次 IPC/网络请求都触发
 * readFileSync + JSON.parse 阻塞主进程事件循环。
 *
 * 双重失效策略：
 * 1. fs.watch 监听文件变化（外部修改、原子替换）→ 主动失效缓存
 * 2. fs.statSync/stat 比对 mtime → fs.watch 未触发或失败时的兜底
 *
 * 保留 sync 版本以适配现有调用链（如 getXxxSync 供 request.ts
 * 同步注入 Authorization/Cookie header）；async 版本供已是 async 的
 * IPC handler 直接 await。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";

interface CacheEntry<T> {
  value: T | null;
  /** -1 表示文件不存在 */
  mtimeMs: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const watchers = new Map<string, fs.FSWatcher>();

/** 尝试为文件注册 fs.watch；文件不存在或权限不足时静默失败 */
const trySetupWatcher = (filePath: string): void => {
  if (watchers.has(filePath)) return;
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(filePath, { persistent: false });
  } catch {
    return;
  }
  watchers.set(filePath, watcher);
  watcher.on("change", () => {
    cache.delete(filePath);
  });
  watcher.on("error", () => {
    cache.delete(filePath);
    watchers.delete(filePath);
    try {
      watcher.close();
    } catch {
      /* ignore */
    }
  });
};

/**
 * 同步读取并解析 JSON 文件，带内存缓存。
 *
 * 首次调用：statSync + readFileSync + JSON.parse + 缓存 + 注册 fs.watch
 * 后续调用：statSync mtime 比对（小文件 ~0.05ms），命中直接返回缓存
 * 文件变化：fs.watch 触发失效 → 下次调用重新读取
 *
 * 适合被高频调用的凭证文件（cookie/token），保留同步签名以适配现有调用链。
 */
export const readCachedJsonSync = <T>(filePath: string): T | null => {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    // 文件不存在
  }
  const cached = cache.get(filePath) as CacheEntry<T> | undefined;
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.value;
  }
  let value: T | null = null;
  if (mtimeMs !== -1) {
    try {
      value = JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
    } catch {
      value = null;
    }
  }
  cache.set(filePath, { value, mtimeMs });
  if (mtimeMs !== -1) trySetupWatcher(filePath);
  return value;
};

/**
 * 异步读取并解析 JSON 文件，带内存缓存（mtime 失效）。
 *
 * 与 readCachedJsonSync 共享同一份缓存。用于已是 async 的调用路径。
 */
export const readCachedJson = async <T>(filePath: string): Promise<T | null> => {
  let mtimeMs = -1;
  try {
    mtimeMs = (await fsp.stat(filePath)).mtimeMs;
  } catch {
    // 文件不存在
  }
  const cached = cache.get(filePath) as CacheEntry<T> | undefined;
  if (cached && cached.mtimeMs === mtimeMs) {
    return cached.value;
  }
  let value: T | null = null;
  if (mtimeMs !== -1) {
    try {
      value = JSON.parse(await fsp.readFile(filePath, "utf-8")) as T;
    } catch {
      value = null;
    }
  }
  cache.set(filePath, { value, mtimeMs });
  if (mtimeMs !== -1) trySetupWatcher(filePath);
  return value;
};

/**
 * 显式失效缓存（写文件后调用）
 *
 * 写文件 → mtime 必然变化 → 下次读取会重新读取。此函数用于"写后立即读"
 * 场景，避免依赖文件系统 mtime 时序（atomicWriteSync 后立即读取可能拿到旧 mtime）。
 */
export const invalidateCachedFile = (filePath: string): void => {
  cache.delete(filePath);
};
